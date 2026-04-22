/**
 * Time-of-Day Pricer — аналізує конверсії за годинами доби,
 * пропонує "happy hour" знижки в години низької активності.
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
import { loadEffectiveGeoTargets } from "@/lib/acos/loadGeoTargets";
import { rowMatchesGeo, summarizeGeo } from "@/lib/acos/geoTargets";

const AGENT_ID = "time-of-day-pricer";

export const Route = createFileRoute("/hooks/agents/time-of-day-pricer")({
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
          const geo = await loadEffectiveGeoTargets(tenantId, AGENT_ID);
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const [{ data: viewsRaw }, { data: paidRaw }] = await Promise.all([
            supabaseAdmin
              .from("events")
              .select("created_at, payload")
              .eq("tenant_id", tenantId)
              .eq("type", "product_viewed")
              .gte("created_at", since)
              .limit(5000),
            supabaseAdmin
              .from("orders")
              .select("created_at, metadata")
              .eq("tenant_id", tenantId)
              .eq("status", "paid")
              .gte("created_at", since)
              .limit(2000),
          ]);

          const views = (viewsRaw ?? []).filter((v) =>
            rowMatchesGeo({ metadata: (v.payload ?? null) as Record<string, unknown> | null }, geo),
          );
          const paid = (paidRaw ?? []).filter((o) =>
            rowMatchesGeo({ metadata: o.metadata as Record<string, unknown> | null }, geo),
          );

          const viewsByHour = new Array(24).fill(0);
          const ordersByHour = new Array(24).fill(0);
          for (const v of views) viewsByHour[new Date(v.created_at).getUTCHours()]++;
          for (const o of paid) ordersByHour[new Date(o.created_at).getUTCHours()]++;

          const cr = viewsByHour.map((v, i) => (v > 0 ? ordersByHour[i] / v : 0));
          const avgCr = cr.reduce((s, x) => s + x, 0) / 24;

          const lowHours: number[] = [];
          for (let h = 0; h < 24; h++) {
            if (viewsByHour[h] >= 20 && cr[h] > 0 && cr[h] < avgCr * 0.5) {
              lowHours.push(h);
            }
          }

          const insights: AgentInsightInput[] = [];
          if (lowHours.length >= 2 && avgCr > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "happy_hour_opportunity",
              affected_layer: "pricing",
              title: `⏰ "Happy hour" вікно: ${lowHours.map((h) => `${h}:00`).join(", ")} UTC`,
              description: `У ці години CR удвічі нижчий за середній (${(avgCr * 100).toFixed(2)}%). Трафік є — конверсії немає.`,
              expected_impact: `Time-limited 10% знижка може підняти CR до середнього → +${(avgCr * 0.5 * lowHours.length * 50).toFixed(0)} замовлень/міс`,
              confidence: 0.65,
              risk_level: "low",
              metrics: {
                low_conversion_hours_utc: lowHours,
                avg_conversion_rate: avgCr,
                hourly_views: viewsByHour,
                hourly_orders: ordersByHour,
                suggested_action: "schedule_happy_hour_promo",
              },
              dedup_key: `happy-hour::${lowHours.join(",")}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            avg_cr: avgCr,
            low_hours_count: lowHours.length,
            geo: summarizeGeo(geo, "en"),
            views_in_scope: views.length,
            orders_in_scope: paid.length,
          });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Time-of-day pricer failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
