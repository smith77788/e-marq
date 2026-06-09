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
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parsePriceToCents } from "@/lib/integrations/parser";

/**
 * Shopify webhook topics → our internal entity kind.
 * See: https://shopify.dev/docs/api/admin-rest/2024-10/resources/webhook#event-topics
 */
function shopifyTopicToEntity(topic: string): "products" | "customers" | "orders" | null {
  if (topic.startsWith("products/")) return "products";
  if (topic.startsWith("customers/")) return "customers";
  if (topic.startsWith("orders/")) return "orders";
  return null;
}

/**
 * Verify Shopify HMAC signature. Shopify signs the raw request body with the
 * shared webhook secret using HMAC-SHA256 and sends the result base64-encoded
 * in the X-Shopify-Hmac-Sha256 header. The comparison MUST be timing-safe.
 */
function verifyShopifyHmac(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Map a single native Shopify entity (one product / customer / order) to our
 * canonical row shape so the existing import loop below can process it.
 */
function shopifyEntityToRow(
  entity: "products" | "customers" | "orders",
  it: Record<string, unknown>,
): Record<string, unknown> {
  const asString = (v: unknown): string => (v == null ? "" : String(v));
  if (entity === "products") {
    const variants = (it.variants as Array<Record<string, unknown>>) ?? [];
    const v = variants[0] ?? {};
    const images = (it.images as Array<Record<string, unknown>>) ?? [];
    return {
      name: asString(it.title),
      sku: asString(v.sku),
      price: asString(v.price),
      stock: asString(v.inventory_quantity ?? 0),
      description: asString(it.body_html).replace(/<[^>]+>/g, "").slice(0, 2000),
      image_url: asString((images[0] as { src?: string } | undefined)?.src),
      currency: "UAH",
    };
  }
  if (entity === "customers") {
    return {
      name:
        `${asString(it.first_name)} ${asString(it.last_name)}`.trim() ||
        asString(it.email),
      email: asString(it.email),
      phone: asString(it.phone),
    };
  }
  // orders
  const customer = (it.customer as Record<string, unknown>) ?? {};
  const gateways = it.payment_gateway_names as string[] | undefined;
  return {
    customer_name:
      `${asString(customer.first_name)} ${asString(customer.last_name)}`.trim() ||
      asString(it.email),
    customer_email: asString(it.email ?? customer.email),
    total: asString(it.total_price),
    currency: asString(it.currency || "UAH"),
    status: asString(it.financial_status || "pending"),
    payment_method: asString(gateways?.[0] ?? "manual"),
    external_id: asString(it.id),
  };
}

const BodySchema = z.object({
  entity: z.enum(["products", "customers", "orders"]),
  rows: z
    .array(z.record(z.string().min(1).max(255), z.unknown()))
    .min(1)
    .max(5000),
  mapping: z.record(z.string().min(1).max(64), z.string().min(1).max(255)).optional(),
});

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Run comparison against real secret length to avoid leaking length via timing
    timingSafeEqual(Buffer.alloc(bb.length), Buffer.alloc(bb.length));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Webhook-Secret, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain",
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
            "Access-Control-Allow-Headers":
              "Content-Type, X-Webhook-Secret, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain",
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

          // 1. Знайти інтеграцію (потрібен webhook_secret для будь-якого provider-а).
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

          // 2. Read raw body once — needed for HMAC verification (Shopify) AND parsing.
          const rawBody = await request.text();

          let entity: "products" | "customers" | "orders";
          let rows: Array<Record<string, unknown>>;
          let mapping: Record<string, string> | undefined;

          if (provider === "shopify") {
            // Shopify-native flow: HMAC + per-topic single entity.
            const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";
            const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
            if (!verifyShopifyHmac(rawBody, hmacHeader, integ.webhook_secret)) {
              return jsonResponse({ error: "invalid Shopify HMAC signature" }, 401);
            }
            const topicEntity = shopifyTopicToEntity(topic);
            if (!topicEntity) {
              return jsonResponse({ error: `unsupported Shopify topic: ${topic}` }, 400);
            }
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(rawBody) as Record<string, unknown>;
            } catch {
              return jsonResponse({ error: "invalid JSON body" }, 400);
            }
            entity = topicEntity;
            rows = [shopifyEntityToRow(topicEntity, payload)];
            mapping = undefined;
          } else {
            // Generic flow: shared X-Webhook-Secret + canonical {entity, rows, mapping} body.
            const headerSecret = request.headers.get("x-webhook-secret") ?? "";
            if (!headerSecret) {
              return jsonResponse({ error: "missing X-Webhook-Secret" }, 401);
            }
            if (!timingSafeEqualString(headerSecret, integ.webhook_secret)) {
              return jsonResponse({ error: "invalid secret" }, 401);
            }
            let raw: unknown = null;
            try {
              raw = JSON.parse(rawBody);
            } catch {
              return jsonResponse({ error: "invalid JSON body" }, 400);
            }
            const parsed = BodySchema.safeParse(raw);
            if (!parsed.success) {
              return jsonResponse({ error: "invalid payload", details: parsed.error.format() }, 400);
            }
            entity = parsed.data.entity;
            rows = parsed.data.rows as Array<Record<string, unknown>>;
            mapping = parsed.data.mapping;
          }

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
                const sku = get(row, "sku") || null;
                const payload = {
                  tenant_id: tenantId,
                  name,
                  sku,
                  price_cents: parsePriceToCents(get(row, "price_cents") || get(row, "price")),
                  stock: parseInt(get(row, "stock") || "0", 10) || 0,
                  description: get(row, "description") || null,
                  image_url: get(row, "image_url") || null,
                  currency: (get(row, "currency") || "UAH").toUpperCase().slice(0, 3),
                  is_active: true,
                  metadata: { import_source: provider, import_job_id: job.id },
                };
                const q = sku
                  ? supabaseAdmin.from("products").upsert(payload, { onConflict: "tenant_id,sku" })
                  : supabaseAdmin.from("products").insert(payload);
                const { error } = await q;
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
                const email = get(row, "email").toLowerCase() || null;
                const payload = {
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
                const externalId = get(row, "external_id") || get(row, "id") || null;
                const payload = {
                  tenant_id: tenantId,
                  customer_name: customerName,
                  customer_email: get(row, "customer_email").toLowerCase() || null,
                  total_cents: total,
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
                        total_cents: total,
                        paid_at: payload.paid_at,
                      })
                      .eq("id", existing.id);
                    if (error) {
                      failed++;
                      errors.push({ row: i + 1, message: error.message });
                    } else {
                      skipped++;
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
