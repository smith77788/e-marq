/**
 * POST /hooks/integrations/dntrade-cron
 *
 * Запускається з pg_cron щогодини. Без body — обходить всі активні DN Trade інтеграції.
 * Авторизація: тільки SUPABASE_PUBLISHABLE_KEY (cron-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { runFullDnTradeSync } from "@/lib/dntrade/sync";

export const Route = createFileRoute("/hooks/integrations/dntrade-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token || token !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return jsonError("Unauthorized", 401);
        }

        const { data: integrations, error } = await supabaseAdmin
          .from("tenant_integrations")
          .select("id, tenant_id, credentials_encrypted, last_sync_at")
          .eq("provider", "dntrade")
          .eq("is_active", true);
        if (error) return jsonError(error.message, 500);

        const results: Array<{
          tenant_id: string;
          status: "success" | "failed" | "partial" | "skipped";
          summary?: unknown;
          error?: string;
        }> = [];

        for (const integ of integrations ?? []) {
          if (!integ.credentials_encrypted) {
            results.push({ tenant_id: integ.tenant_id, status: "skipped", error: "no api key" });
            continue;
          }
          try {
            await supabaseAdmin
              .from("tenant_integrations")
              .update({ last_sync_status: "running", last_sync_error: null })
              .eq("id", integ.id);

            const summary = await runFullDnTradeSync(
              supabaseAdmin,
              integ.tenant_id,
              integ.credentials_encrypted,
              { modifiedFromIso: integ.last_sync_at ?? undefined, integrationId: integ.id },
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
            results.push({
              tenant_id: integ.tenant_id,
              status: hasErrors ? "partial" : "success",
              summary,
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            await supabaseAdmin
              .from("tenant_integrations")
              .update({ last_sync_status: "failed", last_sync_error: message })
              .eq("id", integ.id);
            results.push({ tenant_id: integ.tenant_id, status: "failed", error: message });
          }
        }

        return jsonOk({ processed: results.length, results });
      },
    },
  },
});
