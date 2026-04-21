/**
 * POST /hooks/integrations/dntrade-webhook
 *
 * Push-приймач від DN Trade. Кожен tenant має свій URL виду:
 *   /hooks/integrations/dntrade-webhook?tenant=<tenant_id>&secret=<webhook_secret>
 *
 * DN Trade вебхуки шлють події про зміни. Ми НЕ розбираємо payload детально —
 * просто стартуємо інкрементальну синхронізацію (modified_from = last_sync_at).
 * Це робить ендпоінт ідемпотентним і толерантним до різних форматів подій.
 *
 * Безпека: верифікація через query-string secret (тенант сам генерує і передає
 * в DN Trade). Тіло запиту логуємо як evidence в dntrade_sync_errors при помилці.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { runFullDnTradeSync } from "@/lib/dntrade/sync";

export const Route = createFileRoute("/hooks/integrations/dntrade-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenant");
        const secret = url.searchParams.get("secret");

        if (!tenantId) return jsonError("tenant query required", 400);
        if (!secret) return jsonError("secret query required", 401);

        const { data: integ, error: loadErr } = await supabaseAdmin
          .from("tenant_integrations")
          .select("id, tenant_id, credentials_encrypted, webhook_secret, is_active, last_sync_at")
          .eq("tenant_id", tenantId)
          .eq("provider", "dntrade")
          .maybeSingle();

        if (loadErr) return jsonError("DB error", 500);
        if (!integ) return jsonError("Integration not found", 404);
        if (!integ.is_active) return jsonError("Integration disabled", 409);
        if (!integ.webhook_secret || integ.webhook_secret !== secret) {
          return jsonError("Invalid secret", 401);
        }
        if (!integ.credentials_encrypted) return jsonError("Missing API key", 409);

        // Best-effort: log incoming payload for debugging
        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          payload = await request.text().catch(() => null);
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
          const hasErrors = summary.errors.length > 0 || summary.mapping_errors.length > 0;
          await supabaseAdmin
            .from("tenant_integrations")
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: hasErrors ? "partial" : "success",
              last_sync_error: hasErrors
                ? [
                    ...summary.errors,
                    ...summary.mapping_errors.slice(0, 3).map((e) => `${e.kind}:${e.message}`),
                  ].join(" | ")
                : null,
              synced_products_count: summary.products.upserted,
              synced_customers_count: summary.customers.upserted,
              synced_orders_count: summary.orders.inserted,
            })
            .eq("id", integ.id);

          return jsonOk({
            received: true,
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
            raw: { payload } as never,
          });
          return jsonError(message, 500);
        }
      },
    },
  },
});
