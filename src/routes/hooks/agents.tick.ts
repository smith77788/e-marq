/**
 * Per-minute tick: for every active tenant, dispatch outbound queue and run sales-bot.
 * Triggered by pg_cron every minute. No auth (cron-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchTenantOutbound } from "@/lib/acos/channels";
import { runSalesBotForTenant } from "@/lib/acos/salesBot";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  jsonError,
  startAgentRun,
} from "@/lib/acos/agentRuntime";
import { isCronToken } from "@/lib/acos/cronAuth";

const AGENT_ID = "tick";

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

        // tick.ts is cron-only — every iteration runs under the same cron context.
        const tickCtx = { kind: "cron" } as const;
        const summary: Record<string, unknown>[] = [];
        for (const t of tenants) {
          // Per-tenant agent run so /agents.live and HealthCheckAgent can see the pulse.
          let handle: Awaited<ReturnType<typeof startAgentRun>>;
          try {
            handle = await startAgentRun(AGENT_ID, t.id, tickCtx);
          } catch (startErr) {
            summary.push({
              tenant_id: t.id,
              error: `start_run_failed: ${startErr instanceof Error ? startErr.message : String(startErr)}`,
            });
            continue;
          }
          try {
            const sales = await runSalesBotForTenant(t.id, 10);
            const dispatch = await dispatchTenantOutbound(t.id, 50);
            const salesSent =
              typeof sales === "object" && sales !== null && "sent" in sales
                ? (sales as { sent?: number }).sent ?? 0
                : 0;
            const dispatchSent =
              typeof dispatch === "object" && dispatch !== null && "sent" in dispatch
                ? (dispatch as { sent?: number }).sent ?? 0
                : 0;
            await finishAgentRun(handle, 0, {
              sales_messages: salesSent,
              dispatch_messages: dispatchSent,
            });
            summary.push({ tenant_id: t.id, sales, dispatch });
          } catch (err) {
            await failAgentRun(handle, err);
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
