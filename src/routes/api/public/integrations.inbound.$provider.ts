/**
 * Публічний webhook-приймач для зовнішніх систем (Zapier, Make.com, Bitrix24, тощо).
 *
 * URL формат: /api/public/integrations/inbound/{provider}?tenant={tenantId}
 *
 * Безпека:
 *  1) перевіряємо tenant + provider існують у tenant_integrations і is_active=true;
 *  2) перевіряємо заголовок X-Webhook-Secret == tenant_integrations.webhook_secret;
 *  3) очікуємо JSON body { entity: 'products'|'customers'|'orders', rows: [...], mapping?: {...} }.
 *
 * Імпорт виконуємо через існуючий runImport() (через service-role клієнта).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parsePriceToCents } from "@/lib/integrations/parser";

const BodySchema = z.object({
  entity: z.enum(["products", "customers", "orders"]),
  rows: z
    .array(z.record(z.string().min(1).max(255), z.unknown()))
    .min(1)
    .max(5000),
  mapping: z.record(z.string().min(1).max(64), z.string().min(1).max(255)).optional(),
});

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
    },
  });
}

export const Route = createFileRoute("/api/public/integrations/inbound/$provider")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
          },
        }),

      POST: async ({ request, params }) => {
        try {
          const provider = String(params.provider).slice(0, 64);
          const url = new URL(request.url);
          const tenantId = url.searchParams.get("tenant");
          if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
            return jsonResponse({ error: "missing or invalid tenant id" }, 400);
          }

          const headerSecret = request.headers.get("x-webhook-secret") ?? "";
          if (!headerSecret) {
            return jsonResponse({ error: "missing X-Webhook-Secret" }, 401);
          }

          // 1. Знайти інтеграцію.
          const { data: integ, error: integErr } = await supabaseAdmin
            .from("tenant_integrations")
            .select("id, webhook_secret, is_active")
            .eq("tenant_id", tenantId)
            .eq("provider", provider)
            .maybeSingle();
          if (integErr) return jsonResponse({ error: integErr.message }, 500);
          if (!integ || !integ.is_active) {
            return jsonResponse({ error: "integration not found or inactive" }, 404);
          }
          if (!integ.webhook_secret) {
            return jsonResponse({ error: "webhook not enabled for this integration" }, 403);
          }
          if (!timingSafeEqualString(headerSecret, integ.webhook_secret)) {
            return jsonResponse({ error: "invalid secret" }, 401);
          }

          // 2. Розпарсити body.
          const raw = await request.json().catch(() => null);
          const parsed = BodySchema.safeParse(raw);
          if (!parsed.success) {
            return jsonResponse({ error: "invalid payload", details: parsed.error.format() }, 400);
          }
          const { entity, rows, mapping } = parsed.data;

          // 3. Створити job + імпортувати інлайн (для невеликих обсягів).
          const { data: job, error: jobErr } = await supabaseAdmin
            .from("import_jobs")
            .insert({
              tenant_id: tenantId,
              integration_id: integ.id,
              source_provider: provider,
              source_kind: "webhook",
              entity_kind: entity,
              status: "running",
              rows_total: rows.length,
              started_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (jobErr || !job)
            return jsonResponse({ error: jobErr?.message ?? "job create failed" }, 500);

          let imported = 0;
          let failed = 0;
          let skipped = 0;
          const errors: Array<{ row: number; message: string }> = [];

          const get = (row: Record<string, unknown>, canonical: string) => {
            // Якщо є явний mapping — беремо колонку файла; інакше — пряме поле.
            const col = mapping?.[canonical] ?? canonical;
            const v = row[col];
            return v == null ? "" : String(v).trim();
          };

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i] as Record<string, unknown>;
            try {
              if (entity === "products") {
                const name = get(row, "name");
                if (!name) {
                  skipped++;
                  continue;
                }
                const { error } = await supabaseAdmin.from("products").insert({
                  tenant_id: tenantId,
                  name,
                  sku: get(row, "sku") || null,
                  price_cents: parsePriceToCents(get(row, "price_cents") || get(row, "price")),
                  stock: parseInt(get(row, "stock") || "0", 10) || 0,
                  description: get(row, "description") || null,
                  image_url: get(row, "image_url") || null,
                  currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
                  is_active: true,
                  metadata: { import_source: provider, import_job_id: job.id },
                });
                if (error) {
                  failed++;
                  errors.push({ row: i + 1, message: error.message });
                } else imported++;
              } else if (entity === "customers") {
                const name = get(row, "name");
                if (!name) {
                  skipped++;
                  continue;
                }
                const { error } = await supabaseAdmin.from("customers").insert({
                  tenant_id: tenantId,
                  name,
                  email: get(row, "email").toLowerCase() || null,
                  telegram_username: get(row, "telegram_username") || null,
                  metadata: {
                    phone: get(row, "phone") || null,
                    import_source: provider,
                    import_job_id: job.id,
                  },
                });
                if (error) {
                  failed++;
                  errors.push({ row: i + 1, message: error.message });
                } else imported++;
              } else if (entity === "orders") {
                const customerName = get(row, "customer_name") || get(row, "name");
                const total = parsePriceToCents(
                  get(row, "total_cents") || get(row, "total") || get(row, "amount"),
                );
                if (!customerName || !total) {
                  skipped++;
                  continue;
                }
                const rawStatus = (get(row, "status") || "pending").toLowerCase();
                type OS = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
                const map: Record<string, OS> = {
                  pending: "pending",
                  new: "pending",
                  processing: "pending",
                  paid: "paid",
                  complete: "paid",
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
                  rawPm === "stripe" || rawPm === "stripe_card" ? "stripe_card" : "manual";
                const { error } = await supabaseAdmin.from("orders").insert({
                  tenant_id: tenantId,
                  customer_name: customerName,
                  customer_email: get(row, "customer_email").toLowerCase() || null,
                  total_cents: total,
                  currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
                  status: finalStatus,
                  payment_method: paymentMethod,
                  paid_at: finalStatus === "paid" ? new Date().toISOString() : null,
                  metadata: {
                    external_id: get(row, "external_id") || get(row, "id") || null,
                    import_source: provider,
                    import_job_id: job.id,
                  },
                });
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
              last_sync_error: failed > 0 ? `${failed} rows failed` : null,
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
