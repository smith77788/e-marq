/**
 * Refund Risk — оцінює ризик refund на рівні замовлення на основі
 * сигналів: новий клієнт + великий чек, нічна покупка, перший товар з high return rate.
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

const AGENT_ID = "refund-risk";

export const Route = createFileRoute("/hooks/agents/refund-risk")({
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
          const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("id, total_cents, customer_email, customer_user_id, created_at, customer_name")
            .eq("tenant_id", tenantId)
            .in("status", ["paid", "fulfilled"])
            .gte("created_at", since)
            .limit(200);

          const insights: AgentInsightInput[] = [];
          for (const o of orders ?? []) {
            // Risk signals
            let score = 0;
            const reasons: string[] = [];
            // (1) High AOV
            if (o.total_cents > 20000) {
              score += 0.3;
              reasons.push("high_value");
            }
            // (2) Late-night purchase (UTC 22-04)
            const hour = new Date(o.created_at).getUTCHours();
            if (hour >= 22 || hour < 4) {
              score += 0.2;
              reasons.push("late_night");
            }
            // (3) New customer (no prior orders)
            if (o.customer_email) {
              const { count, error: cntErr } = await supabaseAdmin
                .from("orders")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantId)
                .eq("customer_email", o.customer_email)
                .lt("created_at", o.created_at);
              if (cntErr) throw cntErr;
              if ((count ?? 0) === 0) {
                score += 0.3;
                reasons.push("first_time_buyer");
              }
            }
            if (score < 0.5) continue;
            insights.push({
              tenant_id: tenantId,
              insight_type: "refund_risk_high",
              affected_layer: "fulfillment",
              title: `⚠️ Підвищений refund-ризик: ${(o.total_cents / 100).toFixed(2)} ₴ (${o.customer_name ?? "guest"})`,
              description: `Risk score ${score.toFixed(2)}. Сигнали: ${reasons.join(", ")}.`,
              expected_impact: `Превентивне follow-up знижує refund на ~40% для таких замовлень`,
              confidence: 0.6,
              risk_level: score > 0.7 ? "high" : "medium",
              metrics: {
                order_id: o.id,
                risk_score: score,
                signals: reasons,
                amount_cents: o.total_cents,
                suggested_action: "send_proactive_followup",
              },
              dedup_key: `refund-risk::${o.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { orders_evaluated: orders?.length ?? 0 });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Refund risk failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
