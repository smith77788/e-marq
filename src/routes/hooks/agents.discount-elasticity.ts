/**
 * Discount Elasticity (ported from MFD `acos-discount-elasticity`).
 *
 * Бере історичні промо що вже завершились і рахує: на скільки % падала ціна
 * → на скільки % росли продажі. Виводить середню еластичність по всіх промо
 * і знаходить "найкращу" глибину знижки (коли revenue лишається max).
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

export const Route = createFileRoute("/hooks/agents/discount-elasticity")({
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

        const handle = await startAgentRun("discount-elasticity", tenantId, ctx);
        try {
          // Look at promos that ended in last 90d with stats
          const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
          const { data: promos } = await supabaseAdmin
            .from("promotions")
            .select(
              "id, name, value, promo_type, times_used, revenue_cents, cost_cents, starts_at, ends_at",
            )
            .eq("tenant_id", tenantId)
            .gte("starts_at", ninetyDaysAgo)
            .gt("times_used", 0);

          if (!promos || promos.length < 3) {
            await finishAgentRun(handle, 0, {
              reason: "insufficient_promo_history",
              count: promos?.length ?? 0,
            });
            return jsonOk({ insights_created: 0 });
          }

          // For each promo: compute revenue/cost ratio = ROI per discount depth
          const buckets = new Map<
            number,
            { count: number; totalRevenue: number; totalCost: number; totalUses: number }
          >();
          for (const p of promos) {
            // bucket by 5%: 5,10,15,20,25,30+
            const depthPct =
              p.promo_type === "percent_off" ? Math.round(Number(p.value) / 5) * 5 : 10;
            const bucket = Math.min(50, Math.max(5, depthPct));
            const e = buckets.get(bucket) ?? {
              count: 0,
              totalRevenue: 0,
              totalCost: 0,
              totalUses: 0,
            };
            e.count += 1;
            e.totalRevenue += p.revenue_cents;
            e.totalCost += p.cost_cents;
            e.totalUses += p.times_used;
            buckets.set(bucket, e);
          }

          // Find best ROI bucket
          const bucketsArr = [...buckets.entries()].map(([depth, b]) => ({
            depth_pct: depth,
            roi: b.totalCost > 0 ? b.totalRevenue / b.totalCost : 0,
            avg_uses: b.totalUses / b.count,
            promos_count: b.count,
            total_revenue_cents: b.totalRevenue,
          }));
          bucketsArr.sort((a, b) => b.roi - a.roi);

          const insights = [];
          if (bucketsArr.length >= 2) {
            const best = bucketsArr[0];
            const worst = bucketsArr[bucketsArr.length - 1];
            if (best.roi > worst.roi * 1.3 && best.promos_count >= 2) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "discount_sweet_spot",
                affected_layer: "marketing",
                title: `Знижка ${best.depth_pct}% дає найкращий ROI (${best.roi.toFixed(1)}×)`,
                description: `За 90 днів промо ${best.depth_pct}% мали ROI ${best.roi.toFixed(1)}×, проти ${worst.roi.toFixed(1)}× для ${worst.depth_pct}%.`,
                expected_impact: `Стандартизувати наступні промо на ${best.depth_pct}% → +${((best.roi / worst.roi - 1) * 100).toFixed(0)}% ефективності.`,
                confidence: 0.7,
                risk_level: "low" as const,
                metrics: {
                  best_depth_pct: best.depth_pct,
                  best_roi: best.roi,
                  worst_depth_pct: worst.depth_pct,
                  worst_roi: worst.roi,
                  buckets: bucketsArr,
                  total_promos_analyzed: promos.length,
                },
                dedup_key: `discount_sweet::${best.depth_pct}`,
              });
            }

            // Warn on bad-ROI bucket
            if (worst.roi < 1 && worst.promos_count >= 2) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "discount_negative_roi",
                affected_layer: "marketing",
                title: `Знижки ${worst.depth_pct}% дають ROI < 1`,
                description: `Промо з глибиною ${worst.depth_pct}% повертають менше ніж коштують (ROI ${worst.roi.toFixed(2)}×).`,
                expected_impact: `Припинити такі знижки → економія cost_cents без втрати чистого прибутку.`,
                confidence: 0.75,
                risk_level: "medium" as const,
                metrics: {
                  bad_depth_pct: worst.depth_pct,
                  bad_roi: worst.roi,
                  promos_count: worst.promos_count,
                },
                dedup_key: `discount_neg::${worst.depth_pct}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { buckets: bucketsArr });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Discount elasticity failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
