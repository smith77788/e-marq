/**
 * Elasticity Meta Loop — порівнює прогноз з фактом по pricing_decisions:
 * для кожного рішення, де є measured_revenue_lift_cents, рахує
 * прогноз vs факт. Якщо середній bias > 50% → елцентричність моделі
 * системно занижена/завищена → insight "skoryguj price-optimizer-priors".
 *
 * Також перевіряє відсоток відкочених рішень (price-revert): якщо
 * >30% — pricing-агенти діють надто агресивно.
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
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "elasticity-meta-loop";

type Row = {
  agent: string;
  expected_margin_lift_pct: number | null;
  expected_volume_lift_pct: number | null;
  measured_revenue_lift_cents: number | null;
  reverted_at: string | null;
  old_price_cents: number;
  new_price_cents: number;
};

export const Route = createFileRoute("/hooks/agents/elasticity-meta-loop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
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
          const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("pricing_decisions")
            .select(
              "agent, expected_margin_lift_pct, expected_volume_lift_pct, measured_revenue_lift_cents, reverted_at, old_price_cents, new_price_cents",
            )
            .eq("tenant_id", tenantId)
            .gte("applied_at", since)
            .limit(2000);
          if (error) throw error;
          const rows = (data ?? []) as Row[];
          if (rows.length < 10) {
            await finishAgentRun(handle, 0, {
              rows: rows.length,
              reason: "insufficient_decisions",
            });
            return jsonOk({ run_id: handle.runId, rows: rows.length, insights_created: 0 });
          }

          // Bias by agent
          type Stat = { n: number; biasPctSum: number; reverted: number };
          const byAgent = new Map<string, Stat>();
          for (const r of rows) {
            const s = byAgent.get(r.agent) ?? { n: 0, biasPctSum: 0, reverted: 0 };
            s.n++;
            if (r.reverted_at) s.reverted++;
            // Compare: expected vs measured. Use revenue lift as source of truth.
            // expected_revenue_lift ≈ expected_margin_lift_pct * old_price_cents (rough).
            const expected =
              ((r.expected_margin_lift_pct ?? 0) + (r.expected_volume_lift_pct ?? 0)) *
              r.old_price_cents *
              0.5;
            const measured = r.measured_revenue_lift_cents ?? 0;
            if (expected !== 0) {
              const biasPct = (measured - expected) / Math.abs(expected);
              s.biasPctSum += biasPct;
            }
            byAgent.set(r.agent, s);
          }

          const insights: AgentInsightInput[] = [];
          const breakdown: Record<
            string,
            { decisions: number; reverted: number; revert_rate: number; mean_bias_pct: number }
          > = {};
          for (const [agent, s] of byAgent) {
            const meanBias = s.n > 0 ? s.biasPctSum / s.n : 0;
            const revertRate = s.n > 0 ? s.reverted / s.n : 0;
            breakdown[agent] = {
              decisions: s.n,
              reverted: s.reverted,
              revert_rate: revertRate,
              mean_bias_pct: meanBias,
            };

            if (s.n >= 5 && Math.abs(meanBias) > 0.5) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "elasticity_meta_bias",
                affected_layer: "pricing",
                title: `${agent}: систематичний bias ${(meanBias * 100).toFixed(0)}% у прогнозах ціни`,
                description: `Над ${s.n} рішеннями факт ${meanBias > 0 ? "вищий" : "нижчий"} за прогноз на ${Math.abs(meanBias * 100).toFixed(0)}%. Модель ${meanBias > 0 ? "недооцінює" : "переоцінює"} ефект цінових змін.`,
                expected_impact:
                  meanBias > 0
                    ? "Можна сміливіше коригувати ціни — реальний uplift у ~1.5× більший за прогноз."
                    : "Зменши aggressiveness pricing-агентів і додай більше A/B-семплу перед apply.",
                confidence: 0.7,
                risk_level: "medium",
                metrics: {
                  agent,
                  decisions: s.n,
                  mean_bias_pct: meanBias,
                  revert_rate: revertRate,
                  suggested_action: "adjust_pricing_priors",
                },
                dedup_key: `elasticity_bias::${agent}`,
              });
            }

            if (s.n >= 5 && revertRate > 0.3) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "pricing_high_revert_rate",
                affected_layer: "pricing",
                title: `${agent}: ${(revertRate * 100).toFixed(0)}% рішень відкочено`,
                description: `${s.reverted} з ${s.n} цінових змін довелось відкотити — агент діє занадто ризиковано.`,
                expected_impact:
                  "Підняти confidence threshold для цього агента, додати longer A/B period (з 7 до 14 днів).",
                confidence: 0.85,
                risk_level: "high",
                metrics: {
                  agent,
                  decisions: s.n,
                  reverted: s.reverted,
                  revert_rate: revertRate,
                  suggested_action: "raise_confidence_threshold",
                },
                dedup_key: `pricing_revert::${agent}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            decisions_scanned: rows.length,
            agents: byAgent.size,
            breakdown,
          });
          return jsonOk({
            run_id: handle.runId,
            decisions_scanned: rows.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Elasticity meta-loop failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
