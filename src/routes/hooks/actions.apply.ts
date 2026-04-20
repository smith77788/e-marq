/**
 * Apply an approved insight: writes ai_actions log entry and marks insight as applied.
 * The actual side-effect (sending an email, reordering) is recorded as parameters.
 *
 * Body: { insight_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { pickChannelForCustomer } from "@/lib/acos/channels";

async function queueVipProductNudges(tenantId: string, productId: string, sourceInsightId: string): Promise<number> {
  const { data: product } = await supabaseAdmin
    .from("products").select("id, name, price_cents").eq("id", productId).maybeSingle();
  if (!product) return 0;
  const { data: vips } = await supabaseAdmin
    .from("customers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("consent_marketing", true)
    .in("lifecycle_stage", ["vip", "active"])
    .gte("total_orders", 2)
    .limit(20);
  let queued = 0;
  for (const c of vips ?? []) {
    const channel = await pickChannelForCustomer(c.id);
    if (!channel) continue;
    const firstName = (c.name ?? "").split(" ")[0] || "there";
    const body = `Hey ${firstName} — have you tried our <b>${product.name}</b>? It's been getting lots of attention lately. Want me to add one to your next order?`;
    const { error } = await supabaseAdmin.from("outbound_messages").insert({
      tenant_id: tenantId, customer_id: c.id, channel, trigger_kind: "promo",
      template_key: "promo.feature_product.v1", body, status: "pending",
      expected_impact_cents: product.price_cents, related_product_id: product.id,
      metadata: { source_insight_id: sourceInsightId } as never,
    });
    if (!error) queued++;
  }
  return queued;
}

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
  low_engagement_product: { action_type: "vip_product_nudge", agent_id: "aov_optimizer", target_entity: "product" },
  cart_abandon: { action_type: "vip_product_nudge", agent_id: "aov_optimizer", target_entity: "product" },
  price_optimization: { action_type: "update_price", agent_id: "price_optimizer", target_entity: "product" },
  price_revert: { action_type: "revert_price", agent_id: "price_revert_safety", target_entity: "product" },
};

async function applyPriceUpdate(
  tenantId: string,
  productId: string,
  metrics: { current_price_cents?: number; suggested_price_cents?: number },
): Promise<Record<string, unknown>> {
  if (!metrics.suggested_price_cents) return { error: "missing suggested_price_cents in metrics" };
  // Fetch live price first so we record the actual baseline (not stale insight metric)
  const { data: prod } = await supabaseAdmin
    .from("products")
    .select("price_cents")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const oldPrice = prod?.price_cents ?? metrics.current_price_cents ?? null;
  const { error } = await supabaseAdmin
    .from("products")
    .update({ price_cents: metrics.suggested_price_cents })
    .eq("id", productId)
    .eq("tenant_id", tenantId);
  if (error) return { error: error.message };
  return {
    old_price_cents: oldPrice,
    new_price_cents: metrics.suggested_price_cents,
    delta_cents: oldPrice != null ? metrics.suggested_price_cents - oldPrice : null,
  };
}

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

        const m = ins.metrics as {
          product_id?: string;
          email?: string;
          search_term?: string;
          current_price_cents?: number;
          suggested_price_cents?: number;
        };
        const targetId = mapping.target_entity === "product" ? m.product_id ?? null : null;

        // Side effects per action_type
        let sideEffect: Record<string, unknown> = { note: "Action recorded." };
        if (mapping.action_type === "vip_product_nudge" && targetId) {
          const queued = await queueVipProductNudges(ins.tenant_id, targetId, ins.id);
          sideEffect = { queued_messages: queued };
        } else if ((mapping.action_type === "update_price" || mapping.action_type === "revert_price") && targetId) {
          sideEffect = await applyPriceUpdate(ins.tenant_id, targetId, m);
          if (mapping.action_type === "revert_price" && m["source_action_id"]) {
            // Mark the original update_price action as reverted
            await supabaseAdmin
              .from("ai_actions")
              .update({
                reverted_at: new Date().toISOString(),
                reverted_reason: `Conversion drop detected by ${mapping.agent_id}`,
              })
              .eq("id", m["source_action_id"] as string);
          }
        }

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
          actual_result: sideEffect as never,
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
