/**
 * Sales Bot trigger — replies to recent inbound conversations.
 * Body: { tenant_id }
 * Then immediately dispatches.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeAgentRequest,
  startAgentRun,
  finishAgentRun,
  failAgentRun,
  jsonError,
  jsonOk,
} from "@/lib/acos/agentRuntime";
import { runSalesBotForTenant } from "@/lib/acos/salesBot";
import { dispatchTenantOutbound } from "@/lib/acos/channels";

const AGENT_ID = "sales_bot";

export const Route = createFileRoute("/hooks/agents/sales-bot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json()) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const result = await runSalesBotForTenant(tenantId, 20);
          const dispatch = await dispatchTenantOutbound(tenantId, 100);
          await finishAgentRun(handle, result.replied, { ...result, dispatch });
          return jsonOk({ ...result, dispatch });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Sales bot failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
