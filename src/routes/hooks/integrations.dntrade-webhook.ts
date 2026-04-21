/**
 * POST /hooks/integrations/dntrade-webhook
 *
 * Push-приймач від DN Trade. Кожен tenant має свій URL виду:
 *   /hooks/integrations/dntrade-webhook?tenant=<tenant_id>
 *
 * Аутентифікація (по пріоритету):
 *   1. HMAC-SHA256 підпис тіла в заголовку `X-DnTrade-Signature` (hex),
 *      ключ — `webhook_secret` тенанта. Перевірка через timingSafeEqual.
 *      Підтримуємо також формат `sha256=<hex>` (як у GitHub/Stripe).
 *   2. Fallback: query-string `?secret=<webhook_secret>` (для систем, що
 *      не вміють підписувати — DN Trade офіційно не документує підпис).
 *
 * Коди відповіді:
 *   200 — прийнято, синк запущено (або фоновий no-op).
 *   400 — bad request (немає tenant, невалідний JSON, тощо).
 *   401 — немає/невалідний підпис або secret.
 *   404 — інтеграція не знайдена для tenant.
 *   409 — інтеграція вимкнена або відсутній API key.
 *   500 — внутрішня помилка БД.
 *   502 — помилка апстрім-синку з DN Trade.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { runFullDnTradeSync } from "@/lib/dntrade/sync";

/** Constant-time порівняння двох hex-рядків. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Витягти hex-підпис з заголовка, підтримуючи `sha256=...` префікс. */
function extractSignature(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const eq = trimmed.indexOf("=");
  if (eq > 0 && trimmed.slice(0, eq).toLowerCase() === "sha256") {
    return trimmed.slice(eq + 1).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

export const Route = createFileRoute("/hooks/integrations/dntrade-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenant");
        const querySecret = url.searchParams.get("secret");
        const sigHeader =
          request.headers.get("x-dntrade-signature") ??
          request.headers.get("x-webhook-signature");

        if (!tenantId) return jsonError("tenant query required", 400);

        // Завжди читаємо тіло як текст — для верифікації HMAC і логів.
        const rawBody = await request.text().catch(() => "");

        const { data: integ, error: loadErr } = await supabaseAdmin
          .from("tenant_integrations")
          .select(
            "id, tenant_id, credentials_encrypted, webhook_secret, is_active, last_sync_at",
          )
          .eq("tenant_id", tenantId)
          .eq("provider", "dntrade")
          .maybeSingle();

        if (loadErr) return jsonError("DB error", 500);
        if (!integ) return jsonError("Integration not found", 404);
        if (!integ.webhook_secret) {
          return jsonError("Webhook secret not configured", 401);
        }

        // Аутентифікація: HMAC-підпис має пріоритет, інакше query secret.
        let authed = false;
        let authMethod: "hmac" | "query" | "none" = "none";

        const providedSig = extractSignature(sigHeader);
        if (providedSig) {
          const expected = createHmac("sha256", integ.webhook_secret)
            .update(rawBody)
            .digest("hex");
          if (safeEqualHex(providedSig, expected)) {
            authed = true;
            authMethod = "hmac";
          } else {
            return jsonError("Invalid signature", 401);
          }
        } else if (querySecret) {
          // Constant-time порівняння і для query-secret.
          const a = Buffer.from(querySecret);
          const b = Buffer.from(integ.webhook_secret);
          if (a.length === b.length && timingSafeEqual(a, b)) {
            authed = true;
            authMethod = "query";
          } else {
            return jsonError("Invalid secret", 401);
          }
        } else {
          return jsonError("Missing signature or secret", 401);
        }

        if (!authed) return jsonError("Unauthorized", 401);

        if (!integ.is_active) return jsonError("Integration disabled", 409);
        if (!integ.credentials_encrypted) {
          return jsonError("Missing API key", 409);
        }

        // Best-effort: розпарсити payload для логів (не валідуємо схему —
        // DN Trade не документує події).
        let payload: unknown = rawBody;
        if (rawBody) {
          try {
            payload = JSON.parse(rawBody);
          } catch {
            // лишаємо як текст
          }
        }

        try {
          const summary = await runFullDnTradeSync(
            supabaseAdmin,
            integ.tenant_id,
            integ.credentials_encrypted,
            {
              modifiedFromIso: integ.last_sync_at ?? undefined,
              integrationId: integ.id,
            },
          );
          const hasErrors =
            summary.errors.length > 0 || summary.mapping_errors.length > 0;

          await supabaseAdmin
            .from("tenant_integrations")
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: hasErrors ? "partial" : "success",
              last_sync_error: hasErrors
                ? [
                    ...summary.errors,
                    ...summary.mapping_errors
                      .slice(0, 3)
                      .map((e) => `${e.kind}:${e.message}`),
                  ].join(" | ")
                : null,
              synced_products_count: summary.products.upserted,
              synced_customers_count: summary.customers.upserted,
              synced_orders_count: summary.orders.inserted,
            })
            .eq("id", integ.id);

          return jsonOk({
            received: true,
            auth: authMethod,
            triggered_sync: true,
            summary: {
              products: summary.products,
              customers: summary.customers,
              orders: summary.orders,
              mapping_errors_count: summary.mapping_errors.length,
            },
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await supabaseAdmin.from("dntrade_sync_errors").insert({
            tenant_id: integ.tenant_id,
            integration_id: integ.id,
            kind: "webhook",
            message,
            raw: { payload, auth: authMethod } as never,
          });
          // 502 — апстрім (DN Trade) або сайд-ефект синку впав; не клієнт винний.
          return jsonError(message, 502);
        }
      },
    },
  },
});
