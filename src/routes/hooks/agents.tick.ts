/**
 * Per-minute tick: for every active tenant, dispatch outbound queue and run sales-bot.
 * Triggered by pg_cron every minute. No auth (cron-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchTenantOutbound } from "@/lib/acos/channels";
import { runSalesBotForTenant } from "@/lib/acos/salesBot";
import { authorizeAgentRequest, jsonError } from "@/lib/acos/agentRuntime";
import { isCronToken } from "@/lib/acos/cronAuth";

export const Route = createFileRoute("/hooks/agents/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json().catch(() => ({}))) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }

        const tenants = tenantId ? [{ id: tenantId }] : await loadActiveTenantsForCron(token);
        if ("error" in tenants) return jsonError(tenants.error, tenants.status);

        if (tenantId) {
          const ctx = await authorizeAgentRequest(token, tenantId);
          if ("error" in ctx) return jsonError(ctx.error, ctx.status);
        }

        const summary: Record<string, unknown>[] = [];
        for (const t of tenants) {
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

async function loadActiveTenantsForCron(token: string) {
  if (!isCronToken(token)) return { error: "Unauthorized", status: 401 } as const;
  const { data, error } = await supabaseAdmin.from("tenants").select("id").eq("status", "active");
  if (error) return { error: error.message, status: 500 } as const;
  return data ?? [];
}
