/**
 * Apply an approved insight: writes ai_actions log entry and marks insight as applied.
 * The actual side-effect (sending an email, reordering) is recorded as parameters.
 *
 * Body: { insight_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";

type InsightRow = {
  id: string;
  tenant_id: string;
  insight_type: string;
  affected_layer: string | null;
  title: string;
  expected_impact: string | null;
  metrics: Record<string, unknown>;
  status: string;
};

const ACTION_BY_TYPE: Record<string, { action_type: string; agent_id: string; target_entity?: string }> = {
  churn_risk: { action_type: "winback_touch", agent_id: "churn_risk_predictor", target_entity: "customer" },
  stockout_predicted: { action_type: "reorder_request", agent_id: "stockout_predictor", target_entity: "product" },
  aov_leak: { action_type: "abandoned_cart_email", agent_id: "aov_leak_detector", target_entity: "product" },
  search_gap: { action_type: "create_seo_page", agent_id: "search_gap_detector", target_entity: "search_term" },
};

export const Route = createFileRoute("/hooks/actions/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        let insightId: string | null = null;
        try {
          const body = (await request.json()) as { insight_id?: string };
          insightId = body.insight_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!insightId) return jsonError("insight_id required", 400);

        // Look up insight to learn tenant_id (needed for authz)
        const { data: insight, error: insErr } = await supabaseAdmin
          .from("ai_insights")
          .select("id, tenant_id, insight_type, affected_layer, title, expected_impact, metrics, status")
          .eq("id", insightId)
          .single();
        if (insErr || !insight) return jsonError("Insight not found", 404);
        const ins = insight as InsightRow;

        const ctx = await authorizeAgentRequest(token, ins.tenant_id);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const mapping = ACTION_BY_TYPE[ins.insight_type] ?? {
          action_type: "generic_apply",
          agent_id: "orchestrator",
        };

        const m = ins.metrics as { product_id?: string; email?: string; search_term?: string };
        const targetId = mapping.target_entity === "product" ? m.product_id ?? null : null;

        const insertRow = {
          tenant_id: ins.tenant_id,
          agent_id: mapping.agent_id,
          source_insight_id: ins.id,
          action_type: mapping.action_type,
          target_entity: mapping.target_entity ?? null,
          target_id: targetId,
          status: "applied",
          applied_at: new Date().toISOString(),
          expected_impact: ins.expected_impact ?? null,
          parameters: {
            source_metrics: ins.metrics,
            triggered_by: ctx.kind,
          } as never,
          actual_result: { note: "Action recorded; side-effect simulated in this iteration." } as never,
        };
        const { data: action, error: actErr } = await supabaseAdmin
          .from("ai_actions")
          .insert(insertRow)
          .select("id")
          .single();
        if (actErr || !action) return jsonError("Failed to log action", 500, { details: actErr?.message });

        const { error: updErr } = await supabaseAdmin
          .from("ai_insights")
          .update({ status: "applied" })
          .eq("id", ins.id);
        if (updErr) return jsonError("Failed to update insight", 500, { details: updErr.message });

        return jsonOk({ action_id: action.id, action_type: mapping.action_type });
      },
    },
  },
});
