/**
 * Bootstrap Agent: Seasonality Detector
 *
 * Аналізує events + orders за останні 90 днів і знаходить:
 *   - найактивніші години доби (для best-time-to-send)
 *   - найактивніші дні тижня
 *   - тренд (зростає / падає / стабільний)
 *   - найвищу та найнижчу денну виручку
 * Пише bootstrap_facts(seasonality) — використовується best-time-to-send,
 * time-of-day-pricer, predictive-pricing.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  jsonError,
  jsonOk,
  startAgentRun,
} from "@/lib/acos/agentRuntime";
import { upsertBootstrapFacts } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "seasonality_detector";

export const Route = createFileRoute("/hooks/agents/seasonality-detector")({
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
          const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

          const { data, error } = await supabaseAdmin
            .from("orders")
            .select("created_at, total_cents, status")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("created_at", since)
            .limit(5000);
          if (error) throw error;

          const hourCounts = new Array(24).fill(0) as number[];
          const dowCounts = new Array(7).fill(0) as number[];
          const dailyRevenue = new Map<string, number>();

          for (const o of data ?? []) {
            const d = new Date(o.created_at);
            hourCounts[d.getUTCHours()]++;
            dowCounts[d.getUTCDay()]++;
            const dayKey = d.toISOString().slice(0, 10);
            dailyRevenue.set(dayKey, (dailyRevenue.get(dayKey) ?? 0) + (o.total_cents ?? 0));
          }

          const topHours = hourCounts
            .map((count, h) => ({ hour: h, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
          const topDows = dowCounts
            .map((count, d) => ({ dow: d, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);

          // Тренд: порівнюємо першу та другу половину періоду
          const days = Array.from(dailyRevenue.entries()).sort();
          const half = Math.floor(days.length / 2);
          const firstHalf = days.slice(0, half).reduce((s, [, v]) => s + v, 0);
          const secondHalf = days.slice(half).reduce((s, [, v]) => s + v, 0);
          let trend: "growing" | "declining" | "stable" = "stable";
          if (firstHalf > 0 && secondHalf > 0) {
            const change = (secondHalf - firstHalf) / firstHalf;
            if (change > 0.15) trend = "growing";
            else if (change < -0.15) trend = "declining";
          }

          const sortedRev = days.map(([, v]) => v).sort((a, b) => b - a);
          const peakDayCents = sortedRev[0] ?? 0;
          const medianDayCents = sortedRev[Math.floor(sortedRev.length / 2)] ?? 0;

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "seasonality",
              value: {
                samples: data?.length ?? 0,
                period_days: 90,
                top_hours_utc: topHours,
                top_dows: topDows,
                trend,
                trend_change_pct:
                  firstHalf > 0 ? Number(((secondHalf - firstHalf) / firstHalf).toFixed(3)) : null,
                peak_day_cents: peakDayCents,
                median_day_cents: medianDayCents,
                first_half_revenue_cents: firstHalf,
                second_half_revenue_cents: secondHalf,
              },
              confidence: (data?.length ?? 0) >= 30 ? 0.85 : (data?.length ?? 0) >= 10 ? 0.55 : 0.3,
            },
          ]);

          await finishAgentRun(handle, 0, {
            samples: data?.length ?? 0,
            trend,
            top_hour: topHours[0]?.hour,
          });
          return jsonOk({
            run_id: handle.runId,
            insights_created: 0,
            trend,
            samples: data?.length ?? 0,
            top_hours_utc: topHours,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Seasonality detector failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
