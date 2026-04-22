/**
 * Per-minute tick: for every active tenant, dispatch outbound queue and run sales-bot.
 * Triggered by pg_cron every minute. No auth (cron-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchTenantOutbound } from "@/lib/acos/channels";
import { runSalesBotForTenant } from "@/lib/acos/salesBot";

export const Route = createFileRoute("/hooks/agents/tick")({
  server: {
    handlers: {
      POST: async () => {
        const { data: tenants } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("status", "active");

        const summary: Record<string, unknown>[] = [];
        for (const t of tenants ?? []) {
          try {
            const sales = await runSalesBotForTenant(t.id, 10);
            const dispatch = await dispatchTenantOutbound(t.id, 50);
            summary.push({ tenant_id: t.id, sales, dispatch });
          } catch (err) {
            summary.push({
              tenant_id: t.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return new Response(JSON.stringify({ ok: true, tenants: summary.length, summary }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () =>
        new Response(JSON.stringify({ ok: true, hint: "POST to tick all tenants" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
