/**
 * Customer Churn Predictor (ported from MFD `acos-churn-predictor`).
 *
 * Більш просунутий ніж churn-risk: рахує per-customer churn_probability на основі
 * recency / frequency / cycle deviation та пише в customer_ltv_scores. Insight для топ-N ризиків.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  insertInsightsDedup,
  jsonError,
  jsonOk,
  startAgentRun,
} from "@/lib/acos/agentRuntime";

export const Route = createFileRoute("/hooks/agents/customer-churn-predictor")({
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

        const handle = await startAgentRun("customer-churn-predictor", tenantId, ctx);
        try {
          const { data: customers, error: customersErr } = await supabaseAdmin
            .from("customers")
            .select(
              "id, name, email, total_orders, total_spent_cents, last_order_at, avg_cycle_days, predicted_next_order_at",
            )
            .eq("tenant_id", tenantId)
            .gte("total_orders", 1);
          if (customersErr) throw customersErr;

          if (!customers?.length) {
            await finishAgentRun(handle, 0, { reason: "no_customers" });
            return jsonOk({ insights_created: 0 });
          }

          const now = Date.now();
          let scored = 0;
          const ranked: { id: string; name: string; prob: number; reason: string; ltv: number }[] =
            [];

          for (const c of customers) {
            if (!c.last_order_at) continue;
            const daysSince = (now - new Date(c.last_order_at).getTime()) / 86400000;
            const cycle = c.avg_cycle_days ?? null;

            // Probability: 0..1
            // - 1 order, 60+d → 0.5
            // - cycle exists, daysSince > 2× cycle → 0.8
            // - daysSince > 4× cycle OR > 180d → 0.95
            let prob: number;
            let reason: string;
            if (cycle && cycle > 0) {
              const ratio = daysSince / cycle;
              if (ratio < 1) {
                prob = 0.05;
                reason = "on_cycle";
              } else if (ratio < 2) {
                prob = 0.3;
                reason = "slightly_late";
              } else if (ratio < 4) {
                prob = 0.7;
                reason = "very_late";
              } else {
                prob = 0.95;
                reason = "abandoned";
              }
            } else {
              if (daysSince < 30) {
                prob = 0.2;
                reason = "new_buyer";
              } else if (daysSince < 90) {
                prob = 0.5;
                reason = "single_order_aging";
              } else {
                prob = 0.85;
                reason = "single_order_dormant";
              }
            }

            // Persist
            await supabaseAdmin.from("customer_ltv_scores").upsert(
              [
                {
                  tenant_id: tenantId!,
                  customer_id: c.id,
                  churn_probability: prob,
                  churn_reason: reason,
                  predicted_ltv_cents: c.total_spent_cents ?? 0,
                  predicted_orders_12m:
                    prob > 0.7 ? 0 : Math.max(1, Math.round(12 / Math.max(cycle ?? 60, 30))),
                  computed_at: new Date().toISOString(),
                },
              ],
              { onConflict: "tenant_id,customer_id", ignoreDuplicates: false },
            );
            scored++;

            if (prob >= 0.7 && (c.total_spent_cents ?? 0) >= 5000) {
              ranked.push({
                id: c.id,
                name: c.name ?? c.email ?? "клієнт",
                prob,
                reason,
                ltv: c.total_spent_cents ?? 0,
              });
            }
          }

          ranked.sort((a, b) => b.ltv * b.prob - a.ltv * a.prob);

          const insights: Parameters<typeof insertInsightsDedup>[0] = ranked
            .slice(0, 5)
            .map((r) => ({
              tenant_id: tenantId!,
              insight_type: "high_value_churn_risk",
              affected_layer: "lifecycle",
              title: `Високий ризик: ${r.name} (LTV ${(r.ltv / 100).toFixed(0)} ₴)`,
              description: `Ймовірність відтоку ${(r.prob * 100).toFixed(0)}% — причина: ${r.reason}.`,
              expected_impact: `Win-back з знижкою 15-20% повертає ~25-35% таких клієнтів.`,
              confidence: r.prob,
              risk_level: r.ltv >= 20000 ? "high" : "medium",
              metrics: {
                customer_id: r.id,
                customer_name: r.name,
                churn_probability: r.prob,
                churn_reason: r.reason,
                ltv_cents: r.ltv,
              },
              dedup_key: `churn-high::${r.id}`,
            }));

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            scored,
            high_risk_count: ranked.length,
          });
          return jsonOk({ insights_created: created, scored });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Customer churn predictor failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
