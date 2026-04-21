/**
 * Anomaly Detector (ported from MFD `acos-anomaly-detector`).
 *
 * Порівнює сьогоднішні KPI з 7d середнім:
 *  - revenue (sum total_cents для paid orders)
 *  - orders count
 *  - traffic (page_view events)
 *  - conversion rate (purchases / sessions)
 *
 * Якщо відхилення > 30% (і вибірка достатня) → створює insight.
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

export const Route = createFileRoute("/hooks/agents/anomaly-detector")({
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

        const handle = await startAgentRun("anomaly-detector", tenantId, ctx);
        try {
          const now = Date.now();
          const day = 24 * 3600 * 1000;
          const todayStart = new Date(now - day).toISOString();
          const baselineStart = new Date(now - 8 * day).toISOString();
          const baselineEnd = new Date(now - day).toISOString();

          // Fetch in parallel
          const [todayOrdersRes, baseOrdersRes, todayEventsRes, baseEventsRes] = await Promise.all([
            supabaseAdmin
              .from("orders")
              .select("id, total_cents, status, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", todayStart),
            supabaseAdmin
              .from("orders")
              .select("id, total_cents, status, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", baselineStart)
              .lt("created_at", baselineEnd),
            supabaseAdmin
              .from("events")
              .select("type, session_id, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", todayStart),
            supabaseAdmin
              .from("events")
              .select("type, session_id, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", baselineStart)
              .lt("created_at", baselineEnd),
          ]);

          const todayPaid = (todayOrdersRes.data ?? []).filter((o) => o.status === "paid");
          const basePaid = (baseOrdersRes.data ?? []).filter((o) => o.status === "paid");
          const todayRevenue = todayPaid.reduce((s, o) => s + o.total_cents, 0);
          const baseRevenuePerDay =
            basePaid.reduce((s, o) => s + o.total_cents, 0) / 7;
          const todayOrderCount = todayPaid.length;
          const baseOrderCountPerDay = basePaid.length / 7;

          const todaySessions = new Set(
            (todayEventsRes.data ?? []).filter((e) => e.session_id).map((e) => e.session_id),
          ).size;
          const baseSessionsPerDay =
            new Set(
              (baseEventsRes.data ?? []).filter((e) => e.session_id).map((e) => e.session_id),
            ).size / 7;

          const insights = [];

          // Revenue anomaly
          if (baseRevenuePerDay >= 1000) {
            const delta = (todayRevenue - baseRevenuePerDay) / baseRevenuePerDay;
            if (Math.abs(delta) >= 0.3) {
              const direction = delta > 0 ? "up" : "down";
              insights.push({
                tenant_id: tenantId,
                insight_type: direction === "down" ? "revenue_drop" : "revenue_spike",
                affected_layer: "kpi",
                title: `Виторг ${direction === "down" ? "впав" : "виріс"} на ${Math.abs(delta * 100).toFixed(0)}%`,
                description: `Сьогодні: ${formatCents(todayRevenue)} vs середнє ${formatCents(Math.round(baseRevenuePerDay))} за останні 7 днів.`,
                expected_impact:
                  direction === "down"
                    ? `Якщо тренд продовжиться, втрата ~${formatCents(Math.round((baseRevenuePerDay - todayRevenue) * 7))} за тиждень.`
                    : `Якщо втримати — ~${formatCents(Math.round((todayRevenue - baseRevenuePerDay) * 7))} додаткового виторгу за тиждень.`,
                confidence: 0.85,
                risk_level: direction === "down" ? "high" : "low",
                metrics: {
                  today_revenue_cents: todayRevenue,
                  baseline_revenue_cents: Math.round(baseRevenuePerDay),
                  delta_pct: delta,
                  direction,
                },
                dedup_key: `revenue_${direction}::${new Date().toISOString().slice(0, 10)}`,
              } as const);
            }
          }

          // Order count anomaly
          if (baseOrderCountPerDay >= 3) {
            const delta = (todayOrderCount - baseOrderCountPerDay) / baseOrderCountPerDay;
            if (Math.abs(delta) >= 0.4) {
              const direction = delta > 0 ? "up" : "down";
              insights.push({
                tenant_id: tenantId,
                insight_type: direction === "down" ? "orders_drop" : "orders_spike",
                affected_layer: "kpi",
                title: `Кількість замовлень ${direction === "down" ? "впала" : "виросла"} на ${Math.abs(delta * 100).toFixed(0)}%`,
                description: `Сьогодні: ${todayOrderCount} vs середнє ${baseOrderCountPerDay.toFixed(1)} за день.`,
                expected_impact: `Перевір канали трафіку і checkout funnel.`,
                confidence: 0.75,
                risk_level: direction === "down" ? "medium" : "low",
                metrics: {
                  today_orders: todayOrderCount,
                  baseline_orders_per_day: baseOrderCountPerDay,
                  delta_pct: delta,
                  direction,
                },
                dedup_key: `orders_${direction}::${new Date().toISOString().slice(0, 10)}`,
              } as const);
            }
          }

          // Traffic anomaly
          if (baseSessionsPerDay >= 10) {
            const delta = (todaySessions - baseSessionsPerDay) / baseSessionsPerDay;
            if (Math.abs(delta) >= 0.4) {
              const direction = delta > 0 ? "up" : "down";
              insights.push({
                tenant_id: tenantId,
                insight_type: direction === "down" ? "traffic_drop" : "traffic_spike",
                affected_layer: "traffic",
                title: `Трафік ${direction === "down" ? "впав" : "виріс"} на ${Math.abs(delta * 100).toFixed(0)}%`,
                description: `${todaySessions} сесій сьогодні vs ${baseSessionsPerDay.toFixed(0)} в середньому.`,
                expected_impact: direction === "down" ? "Перевір SEO/ads/email кампанії." : "Скейли перевірені канали.",
                confidence: 0.7,
                risk_level: direction === "down" ? "medium" : "low",
                metrics: {
                  today_sessions: todaySessions,
                  baseline_sessions_per_day: baseSessionsPerDay,
                  delta_pct: delta,
                  direction,
                },
                dedup_key: `traffic_${direction}::${new Date().toISOString().slice(0, 10)}`,
              } as const);
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            today_revenue_cents: todayRevenue,
            today_orders: todayOrderCount,
            today_sessions: todaySessions,
          });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Anomaly detector failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `${(c / 100).toFixed(c >= 1000 ? 0 : 2)} ₴`;
}
