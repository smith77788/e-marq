/**
 * Manual / cron trigger for outbound dispatcher.
 * Body: { tenant_id? }
 *
 * If tenant_id is omitted (cron) we fan out across every active tenant.
 * Cron auth required for fan-out mode.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { isCronToken } from "@/lib/acos/cronAuth";
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

        if (!tenantId) {
          if (!isCronToken(token)) return jsonError("Unauthorized", 401);
          const { data: tenants, error: tErr } = await supabaseAdmin
            .from("tenants")
            .select("id, slug")
            .eq("status", "active")
            .limit(50);
          if (tErr) return jsonError("tenant_lookup_failed", 500, { details: tErr.message });
          const out: Array<Record<string, unknown>> = [];
          for (const t of tenants ?? []) {
            try {
              const result = await dispatchTenantOutbound(t.id, 100);
              out.push({ tenant: t.slug, ok: true, ...result });
            } catch (err) {
              out.push({
                tenant: t.slug,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          return jsonOk({
            mode: "fan-out",
            tenants_processed: tenants?.length ?? 0,
            per_tenant: out,
          });
        }

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
