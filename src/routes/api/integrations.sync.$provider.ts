/**
 * Захищений ендпоінт для запуску ручної синхронізації з підключеного джерела.
 *
 * POST /api/integrations/sync/{provider}
 * Body: { entityKind: "products" | "customers" | "orders", limit?: number }
 *
 * Авторизація: Bearer token користувача (через requireSupabaseAuth-стиль).
 * Перевіряємо, що користувач — admin цього tenant_id (через RLS-фільтри).
 *
 * Алгоритм:
 *  1) Знайти tenant_integrations запис за tenant_id + provider (RLS гарантує доступ).
 *  2) Завантажити дані конектором.
 *  3) Запустити runImport через service-role.
 *  4) Оновити last_sync_at / last_sync_status.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CORS_HEADERS, withCors } from "@/lib/http/cors";
import { isConnectorSupported, runConnectorPull } from "@/lib/integrations/connectors";
import { parsePriceToCents, type EntityKind } from "@/lib/integrations/parser";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
type OrderInsert = Database["public"]["Tables"]["orders"]["Insert"];

const BodySchema = z.object({
  entityKind: z.enum(["products", "customers", "orders"]),
  tenantId: z.string().uuid(),
  limit: z.number().int().min(1).max(1000).optional(),
});

function jsonResponse(body: unknown, status = 200) {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

export const Route = createFileRoute("/api/integrations/sync/$provider")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request, params }) => {
        try {
          const provider = String(params.provider).slice(0, 64);
          if (!isConnectorSupported(provider)) {
            return jsonResponse({ error: `Конектор "${provider}" не підтримує авто-синк.` }, 400);
          }

          // 1. Перевірка авторизації — користувач повинен бути autneticated.
          const authHeader = request.headers.get("authorization") ?? "";
          if (!authHeader.startsWith("Bearer ")) {
            return jsonResponse({ error: "Unauthorized" }, 401);
          }
          const token = authHeader.slice(7);
          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userErr } = await userClient.auth.getUser(token);
          if (userErr || !userData?.user?.id) {
            return jsonResponse({ error: "Invalid token" }, 401);
          }
          const userId = userData.user.id;

          // 2. Парсимо body.
          const raw = await request.json().catch(() => null);
          const parsed = BodySchema.safeParse(raw);
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid payload", details: parsed.error.format() }, 400);
          }
          const { entityKind, tenantId, limit } = parsed.data;

          // Guard: self-serve tenants may be pending immediately after onboarding.
          const { data: tenant } = await supabaseAdmin
            .from("tenants")
            .select("status")
            .eq("id", tenantId)
            .maybeSingle();
          if (tenant && !["active", "pending"].includes(tenant.status)) {
            return jsonResponse(
              {
                error:
                  "Бренд заблоковано або архівовано. Синхронізація недоступна для цього статусу.",
              },
              403,
            );
          }

          // 3. RLS перевірка: tenant_integrations доступний користувачу як admin.
          const { data: integ, error: integErr } = await userClient
            .from("tenant_integrations")
            .select("id, credentials_encrypted, config, is_active")
            .eq("tenant_id", tenantId)
            .eq("provider", provider)
            .maybeSingle();
          if (integErr) return jsonResponse({ error: integErr.message }, 403);
          if (!integ)
            return jsonResponse({ error: "Інтеграцію не знайдено або немає доступу." }, 404);
          if (!integ.is_active) return jsonResponse({ error: "Інтеграція деактивована." }, 400);

          // 3.5 Створюємо import_job ОДРАЗУ (status=running), щоб журнал завжди мав запис.
          const { data: job, error: jobErr } = await supabaseAdmin
            .from("import_jobs")
            .insert({
              tenant_id: tenantId,
              integration_id: integ.id,
              source_provider: provider,
              source_kind: "scheduled",
              entity_kind: entityKind,
              status: "running",
              rows_total: 0,
              created_by: userId,
              started_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (jobErr || !job) return jsonResponse({ error: jobErr?.message ?? "job error" }, 500);

          // 4. Тягнемо дані з зовнішнього API.
          let pulled;
          try {
            pulled = await runConnectorPull({
              provider,
              entityKind: entityKind as EntityKind,
              credentials: integ.credentials_encrypted,
              config: (integ.config as Record<string, unknown>) ?? {},
              limit,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Mark job failed
            await supabaseAdmin
              .from("import_jobs")
              .update({
                status: "failed",
                error_summary: [{ row: 0, message: msg }],
                finished_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            // Save tenant_integrations status too.
            await supabaseAdmin
              .from("tenant_integrations")
              .update({
                last_sync_at: new Date().toISOString(),
                last_sync_status: "failed",
                last_sync_error: msg.slice(0, 500),
              })
              .eq("id", integ.id);
            return jsonResponse({ error: msg, jobId: job.id }, 502);
          }

          // 5. Оновлюємо rows_total після успішного pull.
          await supabaseAdmin
            .from("import_jobs")
            .update({ rows_total: pulled.rows.length })
            .eq("id", job.id);

          // 6. Імпорт.
          let imported = 0,
            failed = 0,
            skipped = 0;
          const errors: Array<{ row: number; message: string }> = [];
          const get = (row: Record<string, unknown>, canonical: string) => {
            const col = pulled.mapping[canonical] ?? canonical;
            const v = row[col];
            return v == null ? "" : String(v).trim();
          };

          for (let i = 0; i < pulled.rows.length; i++) {
            const row = pulled.rows[i] as Record<string, unknown>;
            try {
              if (entityKind === "products") {
                const name = get(row, "name");
                if (!name) {
                  skipped++;
                  continue;
                }
                const sku = get(row, "sku") || null;
                const payload: ProductInsert = {
                  tenant_id: tenantId,
                  name,
                  sku,
                  price_cents: parsePriceToCents(get(row, "price_cents")),
                  stock: parseInt(get(row, "stock") || "0", 10) || 0,
                  description: get(row, "description") || null,
                  image_url: get(row, "image_url") || null,
                  currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
                  is_active: true,
                  metadata: { import_source: provider, import_job_id: job.id },
                };
                // Якщо sku є — upsert по (tenant_id, sku); якщо немає — insert.
                const q = sku
                  ? supabaseAdmin.from("products").upsert(payload, { onConflict: "tenant_id,sku" })
                  : supabaseAdmin.from("products").insert(payload);
                const { error } = await q;
                if (error) {
                  failed++;
                  errors.push({ row: i + 1, message: error.message });
                } else imported++;
              } else if (entityKind === "customers") {
                const name = get(row, "name");
                if (!name) {
                  skipped++;
                  continue;
                }
                const email = get(row, "email").toLowerCase() || null;
                const payload: CustomerInsert = {
                  tenant_id: tenantId,
                  name,
                  email,
                  telegram_username: get(row, "telegram_username") || null,
                  metadata: {
                    phone: get(row, "phone") || null,
                    import_source: provider,
                    import_job_id: job.id,
                  },
                };
                // Дедуплікація по email (якщо є) — UNIQUE INDEX customers_tenant_email_uq.
                const q = email
                  ? supabaseAdmin
                      .from("customers")
                      .upsert(payload, { onConflict: "tenant_id,email" })
                  : supabaseAdmin.from("customers").insert(payload);
                const { error } = await q;
                if (error) {
                  failed++;
                  errors.push({ row: i + 1, message: error.message });
                } else imported++;
              } else if (entityKind === "orders") {
                const customerName = get(row, "customer_name");
                const totalCents = parsePriceToCents(get(row, "total_cents"));
                if (!customerName || !totalCents) {
                  skipped++;
                  continue;
                }
                const rawStatus = (get(row, "status") || "pending").toLowerCase();
                type OS = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
                const map: Record<string, OS> = {
                  pending: "pending",
                  new: "pending",
                  processing: "pending",
                  on_hold: "pending",
                  paid: "paid",
                  complete: "paid",
                  succeeded: "paid",
                  shipped: "fulfilled",
                  completed: "fulfilled",
                  fulfilled: "fulfilled",
                  delivered: "fulfilled",
                  cancelled: "cancelled",
                  canceled: "cancelled",
                  refunded: "refunded",
                };
                const finalStatus: OS = map[rawStatus] ?? "pending";
                const rawPm = get(row, "payment_method").toLowerCase();
                const paymentMethod =
                  rawPm === "stripe_card" || rawPm === "stripe" ? "stripe_card" : "manual";
                const externalId = get(row, "external_id") || null;
                const payload: OrderInsert = {
                  tenant_id: tenantId,
                  customer_name: customerName,
                  customer_email: get(row, "customer_email").toLowerCase() || null,
                  total_cents: totalCents,
                  currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
                  status: finalStatus,
                  payment_method: paymentMethod,
                  paid_at: finalStatus === "paid" ? new Date().toISOString() : null,
                  metadata: {
                    external_id: externalId,
                    import_source: provider,
                    import_job_id: job.id,
                  },
                };
                // Дедуплікація: якщо order з таким external_id вже існує — оновлюємо статус, інакше insert.
                if (externalId) {
                  const { data: existing } = await supabaseAdmin
                    .from("orders")
                    .select("id")
                    .eq("tenant_id", tenantId)
                    .eq("metadata->>external_id", externalId)
                    .maybeSingle();
                  if (existing) {
                    const { error } = await supabaseAdmin
                      .from("orders")
                      .update({
                        status: finalStatus,
                        total_cents: totalCents,
                        paid_at: payload.paid_at,
                      })
                      .eq("id", existing.id);
                    if (error) {
                      failed++;
                      errors.push({ row: i + 1, message: error.message });
                    } else {
                      skipped++; // не створили новий — оновили існуючий
                    }
                    continue;
                  }
                }
                const { error } = await supabaseAdmin.from("orders").insert(payload);
                if (error) {
                  failed++;
                  errors.push({ row: i + 1, message: error.message });
                } else imported++;
              }
            } catch (e) {
              failed++;
              errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
            }
          }

          await supabaseAdmin
            .from("import_jobs")
            .update({
              status: failed > 0 ? "completed_with_errors" : "completed",
              rows_imported: imported,
              rows_skipped: skipped,
              rows_failed: failed,
              error_summary: errors.slice(0, 50),
              finished_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          await supabaseAdmin
            .from("tenant_integrations")
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: failed > 0 ? "completed_with_errors" : "completed",
              last_sync_error: failed > 0 ? `${failed} рядків з помилками` : null,
            })
            .eq("id", integ.id);

          return jsonResponse({
            ok: true,
            jobId: job.id,
            imported,
            skipped,
            failed,
            errors: errors.slice(0, 10),
          });
        } catch (e) {
          return jsonResponse({ error: e instanceof Error ? e.message : "internal error" }, 500);
        }
      },
    },
  },
});
