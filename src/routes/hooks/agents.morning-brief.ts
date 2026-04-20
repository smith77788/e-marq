/**
 * Owner Morning Brief (ported from MFD `acos-owner-morning-brief` + `acos-daily-digest`).
 *
 * Раз на день генерує дайджест в daily_digests:
 *  - Revenue / orders за вчора
 *  - Top 3 highlights (виграшні і програшні KPI)
 *  - Top 3 рекомендованих дій з відкритих ai_insights
 *
 * Дайджест ідемпотентний по даті — UNIQUE(tenant_id, digest_date).
 *
 * Body: { tenant_id }
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

export const Route = createFileRoute("/hooks/agents/morning-brief")({
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

        const handle = await startAgentRun("morning-brief", tenantId, ctx);
        try {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
          const dayBefore = new Date(today.getTime() - 2 * 24 * 3600 * 1000);
          const weekAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);

          const digestDate = yesterday.toISOString().slice(0, 10);

          // Skip if already exists
          const { data: existing } = await supabaseAdmin
            .from("daily_digests")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("digest_date", digestDate)
            .maybeSingle();
          if (existing) {
            await finishAgentRun(handle, 0, { reason: "already_generated", digest_date: digestDate });
            return jsonOk({ insights_created: 0, reason: "already_generated" });
          }

          // Yesterday data
          const [yOrders, dOrders, weekEvents, openInsights, atRisk] = await Promise.all([
            supabaseAdmin
              .from("orders")
              .select("id, total_cents, status")
              .eq("tenant_id", tenantId)
              .gte("created_at", yesterday.toISOString())
              .lt("created_at", today.toISOString()),
            supabaseAdmin
              .from("orders")
              .select("id, total_cents, status")
              .eq("tenant_id", tenantId)
              .gte("created_at", dayBefore.toISOString())
              .lt("created_at", yesterday.toISOString()),
            supabaseAdmin
              .from("events")
              .select("type, session_id, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", weekAgo.toISOString()),
            supabaseAdmin
              .from("ai_insights")
              .select("id, title, insight_type, risk_level, expected_impact")
              .eq("tenant_id", tenantId)
              .eq("status", "new")
              .order("created_at", { ascending: false })
              .limit(50),
            supabaseAdmin
              .from("customer_ltv_scores")
              .select("customer_id, predicted_ltv_cents")
              .eq("tenant_id", tenantId)
              .gte("churn_probability", 0.7),
          ]);

          const yPaid = (yOrders.data ?? []).filter((o) => o.status === "paid");
          const dPaid = (dOrders.data ?? []).filter((o) => o.status === "paid");
          const yRevenue = yPaid.reduce((s, o) => s + o.total_cents, 0);
          const dRevenue = dPaid.reduce((s, o) => s + o.total_cents, 0);
          const revenueDelta = dRevenue > 0 ? (yRevenue - dRevenue) / dRevenue : 0;

          const ySessions = new Set(
            (weekEvents.data ?? [])
              .filter(
                (e) =>
                  e.session_id &&
                  new Date(e.created_at).getTime() >= yesterday.getTime() &&
                  new Date(e.created_at).getTime() < today.getTime(),
              )
              .map((e) => e.session_id),
          ).size;
          const yConversions = yPaid.length;
          const yConvRate = ySessions > 0 ? yConversions / ySessions : 0;

          const atRiskValue = (atRisk.data ?? []).reduce(
            (s, c) => s + (c.predicted_ltv_cents ?? 0),
            0,
          );

          const highlights: Array<{ kind: string; text: string }> = [];
          highlights.push({
            kind: "revenue",
            text: `Виторг вчора: ${formatCents(yRevenue)} (${revenueDelta >= 0 ? "+" : ""}${(revenueDelta * 100).toFixed(0)}% vs позавчора)`,
          });
          highlights.push({
            kind: "orders",
            text: `${yPaid.length} оплачених замовлень з ${ySessions} сесій (CR ${(yConvRate * 100).toFixed(1)}%)`,
          });
          if (atRisk.data?.length) {
            highlights.push({
              kind: "retention",
              text: `${atRisk.data.length} клієнтів у зоні ризику відтоку (потенційна втрата ${formatCents(atRiskValue)})`,
            });
          }

          const topActions = (openInsights.data ?? [])
            .sort((a, b) => {
              const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
              return (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3);
            })
            .slice(0, 3)
            .map((i) => ({
              insight_id: i.id,
              title: i.title,
              expected_impact: i.expected_impact,
              risk_level: i.risk_level,
            }));

          let summary = `Доброго ранку. Вчора зароблено ${formatCents(yRevenue)} `;
          summary +=
            revenueDelta >= 0
              ? `(+${(revenueDelta * 100).toFixed(0)}% — ріст). `
              : `(${(revenueDelta * 100).toFixed(0)}% — спад). `;
          if (topActions.length) {
            summary += `Чекає ${openInsights.data?.length ?? 0} нових інсайтів, з них ${topActions.filter((a) => a.risk_level === "high").length} високого пріоритету.`;
          } else {
            summary += `Нових інсайтів немає — все стабільно.`;
          }

          // Insert digest
          await supabaseAdmin.from("daily_digests").insert({
            tenant_id: tenantId,
            digest_date: digestDate,
            summary,
            highlights,
            metrics: {
              revenue_cents: yRevenue,
              prev_revenue_cents: dRevenue,
              revenue_delta_pct: revenueDelta,
              orders: yPaid.length,
              sessions: ySessions,
              conversion_rate: yConvRate,
              at_risk_customers: atRisk.data?.length ?? 0,
              at_risk_value_cents: atRiskValue,
              open_insights: openInsights.data?.length ?? 0,
            },
            recommended_actions: topActions,
          });

          // Also push to owner_notifications feed
          await supabaseAdmin.from("owner_notifications").insert({
            tenant_id: tenantId,
            kind: "daily_digest",
            severity: revenueDelta < -0.2 ? "warning" : "info",
            title: `Ранковий бриф — ${digestDate}`,
            body: summary,
            link: "/brand",
            metadata: { digest_date: digestDate },
          });

          await finishAgentRun(handle, 1, { digest_date: digestDate });
          return jsonOk({ insights_created: 1, digest_date: digestDate });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Morning brief failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `$${(c / 100).toFixed(c >= 1000 ? 0 : 2)}`;
}
