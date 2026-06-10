/**
 * AI Memory Feedback Loop.
 *
 * Scans applied actions whose 7-day measurement window has elapsed and updates
 * `ai_memory` patterns. Heuristics:
 *  - For churn_risk + winback: success if customer_email placed any new paid
 *    order after applied_at and within 30 days.
 *  - For aov_leak + abandoned_cart_email: success if any new paid order with
 *    that product in line items after applied_at within 14 days.
 *  - For stockout + reorder_request: success if product stock has increased
 *    since applied_at (proxy: not stocked-out yet & velocity sustained).
 *  - For search_gap + create_seo_page: neutral (manual outcome) — recorded
 *    as observed only.
 *
 * Body: { tenant_id }. Cron-eligible (publishable key) or super_admin / member JWT.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";

type ActionRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  action_type: string;
  applied_at: string;
  parameters: { source_metrics?: Record<string, unknown> } | null;
  source_insight_id: string | null;
};

export const Route = createFileRoute("/hooks/agents/memory-feedback")({
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

        // Pull applied actions older than 7 days, not yet measured
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: actions, error } = await supabaseAdmin
          .from("ai_actions")
          .select(
            "id, tenant_id, agent_id, action_type, applied_at, parameters, source_insight_id, measured_at",
          )
          .eq("tenant_id", tenantId)
          .eq("status", "applied")
          .is("measured_at", null)
          .lte("applied_at", sevenDaysAgo)
          .limit(200);
        if (error) return jsonError("Failed to fetch actions", 500, { details: error.message });

        let measured = 0;
        let succeeded = 0;
        let failed = 0;
        const memoryUpdates: Array<{
          pattern_key: string;
          agent: string;
          category: string;
          success: boolean;
          impact_cents: number;
        }> = [];

        for (const a of (actions ?? []) as ActionRow[]) {
          const result = await evaluateAction(a);
          if (!result) continue;
          measured++;
          if (result.success) succeeded++;
          else failed++;

          memoryUpdates.push({
            pattern_key: result.pattern_key,
            agent: a.agent_id,
            category: a.action_type,
            success: result.success,
            impact_cents: result.impact_cents,
          });

          const { error: markErr } = await supabaseAdmin
            .from("ai_actions")
            .update({
              measured_at: new Date().toISOString(),
              actual_result: {
                ...result.detail,
                success: result.success,
                impact_cents: result.impact_cents,
              } as never,
            })
            .eq("id", a.id);
          if (markErr) {
            console.error("[memory-feedback] ai_actions mark measured failed:", markErr.message);
            continue;
          }
        }

        // Aggregate updates by pattern
        const grouped = new Map<
          string,
          {
            agent: string;
            category: string;
            success: number;
            failure: number;
            total_impact: number;
            count: number;
          }
        >();
        for (const u of memoryUpdates) {
          const k = `${u.agent}::${u.category}::${u.pattern_key}`;
          const cur = grouped.get(k) ?? {
            agent: u.agent,
            category: u.category,
            success: 0,
            failure: 0,
            total_impact: 0,
            count: 0,
          };
          if (u.success) cur.success++;
          else cur.failure++;
          cur.total_impact += u.impact_cents;
          cur.count++;
          grouped.set(k, cur);
        }

        for (const [key, g] of grouped.entries()) {
          const pattern_key = key.split("::").slice(2).join("::");
          // Upsert via select-then-insert/update to merge counters
          const { data: existing } = await supabaseAdmin
            .from("ai_memory")
            .select("id, success_count, failure_count, avg_impact, evidence")
            .eq("tenant_id", tenantId)
            .eq("agent", g.agent)
            .eq("category", g.category)
            .eq("pattern_key", pattern_key)
            .maybeSingle();

          const newSucc = (existing?.success_count ?? 0) + g.success;
          const newFail = (existing?.failure_count ?? 0) + g.failure;
          const total = newSucc + newFail;
          const confidence = total > 0 ? Number((newSucc / total).toFixed(3)) : 0.5;
          const newAvg =
            total > 0
              ? Number(
                  (
                    ((existing?.avg_impact ?? 0) * (total - g.count) +
                      (g.total_impact / Math.max(g.count, 1)) * g.count) /
                    total
                  ).toFixed(2),
                )
              : 0;

          if (existing?.id) {
            const { error: updErr } = await supabaseAdmin
              .from("ai_memory")
              .update({
                success_count: newSucc,
                failure_count: newFail,
                avg_impact: newAvg,
                confidence,
                last_observed_at: new Date().toISOString(),
                is_active: confidence >= 0.4,
                learned_rule: deriveRule(g.category, confidence, newSucc, newFail),
              })
              .eq("id", existing.id);
            if (updErr) console.error("[memory-feedback] ai_memory update failed:", updErr.message);
          } else {
            const { error: insErr } = await supabaseAdmin.from("ai_memory").insert({
              tenant_id: tenantId,
              agent: g.agent,
              category: g.category,
              pattern_key,
              success_count: newSucc,
              failure_count: newFail,
              avg_impact: newAvg,
              confidence,
              learned_rule: deriveRule(g.category, confidence, newSucc, newFail),
              evidence: { last_batch: g } as never,
            });
            if (insErr) console.error("[memory-feedback] ai_memory insert failed:", insErr.message);
          }
        }

        return jsonOk({
          actions_measured: measured,
          succeeded,
          failed,
          patterns_updated: grouped.size,
        });
      },
    },
  },
});

function deriveRule(category: string, confidence: number, succ: number, fail: number) {
  const pct = (confidence * 100).toFixed(0);
  if (confidence >= 0.7)
    return `${category}: high success rate ${pct}% over ${succ + fail} trials — boost similar insights.`;
  if (confidence >= 0.4) return `${category}: mixed performance ${pct}% — keep observing.`;
  return `${category}: low success rate ${pct}% — deprioritize this pattern.`;
}

type EvalResult = {
  success: boolean;
  impact_cents: number;
  pattern_key: string;
  detail: Record<string, unknown>;
};

async function evaluateAction(a: ActionRow): Promise<EvalResult | null> {
  const m = (a.parameters?.source_metrics ?? {}) as Record<string, unknown>;
  const appliedAt = new Date(a.applied_at).toISOString();

  if (a.action_type === "winback_touch") {
    const email = typeof m.email === "string" ? m.email : null;
    if (!email) return null;
    const cutoff = new Date(new Date(a.applied_at).getTime() + 30 * 86400000).toISOString();
    const { data } = await supabaseAdmin
      .from("orders")
      .select("id, total_cents, created_at")
      .eq("tenant_id", a.tenant_id)
      .eq("customer_email", email)
      .in("status", ["paid", "fulfilled"])
      .gte("created_at", appliedAt)
      .lte("created_at", cutoff)
      .limit(5);
    const success = (data?.length ?? 0) > 0;
    const impact = (data ?? []).reduce((s, o) => s + (o.total_cents ?? 0), 0);
    const cohort = typeof m.cohort === "string" ? m.cohort : "unknown";
    return {
      success,
      impact_cents: impact,
      pattern_key: `cohort:${cohort}`,
      detail: { recovered_orders: data?.length ?? 0, recovered_revenue_cents: impact },
    };
  }

  if (a.action_type === "abandoned_cart_email") {
    const productId = typeof m.product_id === "string" ? m.product_id : null;
    if (!productId) return null;
    const cutoff = new Date(new Date(a.applied_at).getTime() + 14 * 86400000).toISOString();
    const { data } = await supabaseAdmin
      .from("order_items")
      .select("id, quantity, unit_price_cents, orders!inner(status, created_at, tenant_id)")
      .eq("tenant_id", a.tenant_id)
      .eq("product_id", productId)
      .gte("orders.created_at", appliedAt)
      .lte("orders.created_at", cutoff)
      .eq("orders.status", "paid")
      .eq("orders.tenant_id", a.tenant_id)
      .limit(50);
    const items = (data ?? []) as Array<{ quantity: number; unit_price_cents: number }>;
    const recoveredRev = items.reduce(
      (s, i) => s + (i.quantity ?? 0) * (i.unit_price_cents ?? 0),
      0,
    );
    const success = items.length >= 1;
    return {
      success,
      impact_cents: recoveredRev,
      pattern_key: `product:${productId}`,
      detail: {
        recovered_units: items.reduce((s, i) => s + (i.quantity ?? 0), 0),
        recovered_revenue_cents: recoveredRev,
      },
    };
  }

  if (a.action_type === "reorder_request") {
    const productId = typeof m.product_id === "string" ? m.product_id : null;
    if (!productId) return null;
    const { data: prod } = await supabaseAdmin
      .from("products")
      .select("stock, name")
      .eq("id", productId)
      .eq("tenant_id", a.tenant_id)
      .single();
    const stock = prod?.stock ?? 0;
    const success = stock > 5; // restock occurred
    return {
      success,
      impact_cents: 0,
      pattern_key: `product:${productId}`,
      detail: { current_stock: stock, restocked: success },
    };
  }

  if (a.action_type === "create_seo_page") {
    const term = typeof m.search_term === "string" ? m.search_term : null;
    if (!term) return null;
    return {
      success: true, // logged as observed; manual outcome
      impact_cents: 0,
      pattern_key: `term:${term}`,
      detail: { note: "manual_outcome", search_term: term },
    };
  }

  return null;
}
