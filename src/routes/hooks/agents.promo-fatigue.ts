/**
 * Promo Fatigue (ported from MFD `acos-promo-fatigue`).
 *
 * Рахує fatigue_score для кожної активної promotion:
 *   - велика usage_limit утилізація
 *   - падіння redemption rate vs початку
 *   - частота показів одній й тій самій когорті
 * Якщо fatigue >= 0.7 → insight "промо втомила, час паузити".
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

export const Route = createFileRoute("/hooks/agents/promo-fatigue")({
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

        const handle = await startAgentRun("promo-fatigue", tenantId, ctx);
        try {
          const { data: promos } = await supabaseAdmin
            .from("promotions")
            .select("id, name, code, times_used, usage_limit, revenue_cents, cost_cents, starts_at, fatigue_score")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);

          if (!promos?.length) {
            await finishAgentRun(handle, 0, { reason: "no_active_promos" });
            return jsonOk({ insights_created: 0 });
          }

          const now = Date.now();
          const insights = [];
          for (const p of promos) {
            const ageDays = Math.max(1, (now - new Date(p.starts_at).getTime()) / (24 * 3600 * 1000));
            const utilization = p.usage_limit ? p.times_used / p.usage_limit : 0;
            const usagePerDay = p.times_used / ageDays;
            const expectedDaily = p.usage_limit ? p.usage_limit / 30 : 5; // assume 30d window
            const decayRatio = expectedDaily > 0 ? Math.min(1, usagePerDay / expectedDaily) : 0;
            const roi = p.cost_cents > 0 ? p.revenue_cents / p.cost_cents : 10;

            // Fatigue: high utilization + low recent usage + low ROI
            let fatigue = 0;
            if (utilization > 0.8) fatigue += 0.4;
            if (decayRatio < 0.3 && ageDays > 7) fatigue += 0.4;
            if (roi < 1.5 && p.cost_cents > 0) fatigue += 0.3;
            if (ageDays > 60) fatigue += 0.2;
            fatigue = Math.min(1, fatigue);

            // Update score regardless
            await supabaseAdmin
              .from("promotions")
              .update({ fatigue_score: fatigue })
              .eq("id", p.id);

            if (fatigue >= 0.7) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "promo_fatigued",
                affected_layer: "marketing",
                title: `Промо "${p.name}" втомила аудиторію`,
                description: `Fatigue score ${fatigue.toFixed(2)}. Утилізація ${(utilization * 100).toFixed(0)}%, ROI ${roi.toFixed(1)}×, активна ${Math.round(ageDays)}д.`,
                expected_impact: `Пауза/заміна звільнить простір для нової кампанії з вищим CTR.`,
                confidence: 0.8,
                risk_level: "low" as const,
                metrics: {
                  promo_id: p.id,
                  promo_name: p.name,
                  promo_code: p.code,
                  fatigue_score: fatigue,
                  utilization,
                  roi,
                  age_days: Math.round(ageDays),
                  times_used: p.times_used,
                  revenue_cents: p.revenue_cents,
                  cost_cents: p.cost_cents,
                },
                dedup_key: `promo_fatigue::${p.id}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { promos_checked: promos.length });
          return jsonOk({ insights_created: created, promos_checked: promos.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Promo fatigue failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
