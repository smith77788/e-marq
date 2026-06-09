/**
 * ACOS Agent: Churn Risk Predictor
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

const AGENT_ID = "churn_risk_predictor";

type OrderRow = {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
  total_cents: number;
  created_at: string;
  metadata: { cohort?: string } | null;
};

export const Route = createFileRoute("/hooks/agents/churn-risk")({
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

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
          const { data: orders, error } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, customer_name, total_cents, created_at, metadata")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .limit(5000);
          if (error) throw error;

          const byCustomer = new Map<string, OrderRow[]>();
          for (const o of (orders ?? []) as OrderRow[]) {
            if (!o.customer_email) continue;
            const arr = byCustomer.get(o.customer_email) ?? [];
            arr.push(o);
            byCustomer.set(o.customer_email, arr);
          }

          const now = Date.now();
          const insights: AgentInsightInput[] = [];
          let vipCount = 0;
          for (const [email, list] of byCustomer.entries()) {
            if (list.length < 4) continue;
            vipCount++;
            list.sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
            const last = new Date(list[list.length - 1].created_at);
            const intervals: number[] = [];
            for (let i = 1; i < list.length; i++) {
              intervals.push(
                (new Date(list[i].created_at).getTime() -
                  new Date(list[i - 1].created_at).getTime()) /
                  86400000,
              );
            }
            const avg = intervals.reduce((s, x) => s + x, 0) / intervals.length;
            const recency = (now - last.getTime()) / 86400000;
            const drift = avg > 0 ? recency / avg : 0;
            const totalSpent = list.reduce((s, o) => s + (o.total_cents ?? 0), 0);
            if (drift > 1.5 && recency >= 14) {
              const expectedRevenueCents = Math.round(totalSpent / Math.max(list.length, 1));
              const confidence = Math.min(0.95, 0.5 + Math.min(drift - 1.5, 1.5) * 0.2);
              const risk = drift > 3 ? "high" : drift > 2 ? "medium" : "low";
              const name = list[list.length - 1].customer_name;
              insights.push({
                tenant_id: tenantId,
                insight_type: "churn_risk",
                affected_layer: "crm",
                title: `${name ?? email}: ризик відтоку — ${recency.toFixed(0)}д мовчання (норма ${avg.toFixed(0)}д)`,
                description: `VIP-клієнт, ${list.length} замовлень (lifetime ${(totalSpent / 100).toFixed(2)} ₴), не купував ${recency.toFixed(0)} дн. Типовий інтервал ${avg.toFixed(0)}д — drift ${drift.toFixed(2)}×. Рекомендовано winback зі знижкою 15%.`,
                expected_impact: `Повернути ~${(expectedRevenueCents / 100).toFixed(2)} ₴ наступного замовлення`,
                confidence,
                risk_level: risk,
                metrics: {
                  email,
                  customer_name: name,
                  order_count: list.length,
                  total_spent_cents: totalSpent,
                  avg_interval_days: Number(avg.toFixed(2)),
                  recency_days: Number(recency.toFixed(2)),
                  drift_ratio: Number(drift.toFixed(3)),
                  cohort: list[list.length - 1].metadata?.cohort ?? null,
                  suggested_action: "winback_touch",
                  suggested_discount_pct: 15,
                },
                dedup_key: `email:${email}`,
              });
            }
          }

          insights.sort((a, b) => {
            const am = a.metrics as { total_spent_cents?: number; drift_ratio?: number };
            const bm = b.metrics as { total_spent_cents?: number; drift_ratio?: number };
            return (
              (bm.total_spent_cents ?? 0) * (bm.drift_ratio ?? 0) -
              (am.total_spent_cents ?? 0) * (am.drift_ratio ?? 0)
            );
          });
          const top = insights.slice(0, 30);
          const created = await insertInsightsDedup(top);

          await finishAgentRun(handle, created, {
            customers_analyzed: byCustomer.size,
            vip_count: vipCount,
            candidates: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            customers_analyzed: byCustomer.size,
            vip_at_risk: insights.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
