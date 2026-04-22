/**
 * Manual / cron trigger for outbound dispatcher.
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { dispatchTenantOutbound } from "@/lib/acos/channels";

export const Route = createFileRoute("/hooks/engines/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
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

        try {
          const result = await dispatchTenantOutbound(tenantId, 100);
          return jsonOk(result);
        } catch (err) {
          return jsonError("Dispatch failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
