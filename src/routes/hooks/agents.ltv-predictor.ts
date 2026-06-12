/**
 * LTV Predictor (ported from MFD `acos-ltv-predictor` + `acos-customer-churn-predictor`).
 *
 * Для кожного клієнта обчислює:
 *  - predicted_ltv_cents (на 12 міс) на основі avg_order_cents * predicted_orders
 *  - predicted_orders_12m = 365 / avg_cycle_days
 *  - churn_probability (0..1) на основі того, наскільки давно був останній ордер vs avg_cycle
 *
 * Зберігає в customer_ltv_scores. Створює insight тільки про high-value at-risk
 * клієнтів (predicted_ltv > $200 + churn > 0.7).
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

export const Route = createFileRoute("/hooks/agents/ltv-predictor")({
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

        const handle = await startAgentRun("ltv-predictor", tenantId, ctx);
        try {
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select(
              "id, name, email, total_orders, total_spent_cents, avg_order_cents, avg_cycle_days, last_order_at, lifecycle_stage",
            )
            .eq("tenant_id", tenantId)
            .gte("total_orders", 1)
            .limit(5000);
          if (!customers?.length) {
            await finishAgentRun(handle, 0, { reason: "no_customers" });
            return jsonOk({ insights_created: 0, scored: 0 });
          }

          const now = Date.now();
          const upserts = [];
          const insights = [];

          for (const c of customers) {
            const cycle = c.avg_cycle_days ?? 60; // assume 60d default if unknown
            const predictedOrders12m = cycle > 0 ? Math.round(365 / Math.max(cycle, 7)) : 1;
            const avgOrderCents = c.avg_order_cents || (c.total_orders > 0 ? Math.round(c.total_spent_cents / c.total_orders) : 0);
            const predictedLtv = avgOrderCents * Math.max(predictedOrders12m, 1);

            // Churn: how many cycles since last order
            const daysSinceLast = c.last_order_at
              ? (now - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000)
              : 365;
            const cyclesSince = daysSinceLast / Math.max(cycle, 7);
            // Sigmoid-ish: 0 cycles = 0.05 churn, 1 cycle = 0.3, 2 cycles = 0.7, 3+ cycles = 0.95
            let churn = 0.05;
            if (cyclesSince > 0.5) churn = 0.15;
            if (cyclesSince > 1) churn = 0.3;
            if (cyclesSince > 1.5) churn = 0.55;
            if (cyclesSince > 2) churn = 0.75;
            if (cyclesSince > 3) churn = 0.95;

            // Segment heuristic
            let segment = "regular";
            if (predictedLtv > 50000) segment = "vip";
            else if (predictedLtv > 20000) segment = "high_value";
            else if (c.total_orders === 1) segment = "one_time";

            upserts.push({
              tenant_id: tenantId,
              customer_id: c.id,
              predicted_ltv_cents: predictedLtv,
              predicted_orders_12m: predictedOrders12m,
              churn_probability: churn,
              churn_reason: churn > 0.5 ? `${Math.round(daysSinceLast)}d since last order` : null,
              segment,
              computed_at: new Date().toISOString(),
            });

            // High-value at-risk → create insight
            if (predictedLtv > 20000 && churn > 0.7) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "high_value_churn_risk",
                affected_layer: "retention",
                title: `${c.name || c.email || "VIP"}: ризик втрати високоцінного клієнта`,
                description: `Predicted LTV ${(predictedLtv / 100).toFixed(0)} ₴, не купував ${Math.round(daysSinceLast)} днів (зазвичай раз на ${Math.round(cycle)} днів).`,
                expected_impact: `Win-back може зберегти ~${(predictedLtv / 100).toFixed(0)} ₴ протягом 12 міс.`,
                confidence: 0.8,
                risk_level: "high" as const,
                metrics: {
                  customer_id: c.id,
                  customer_name: c.name,
                  customer_email: c.email,
                  predicted_ltv_cents: predictedLtv,
                  churn_probability: churn,
                  days_since_last_order: Math.round(daysSinceLast),
                  avg_cycle_days: cycle,
                  total_orders: c.total_orders,
                  total_spent_cents: c.total_spent_cents,
                },
                dedup_key: `ltv_churn::${c.id}`,
              });
            }
          }

          // Bulk upsert in chunks of 200
          let upserted = 0;
          for (let i = 0; i < upserts.length; i += 200) {
            const chunk = upserts.slice(i, i + 200);
            const { error } = await supabaseAdmin
              .from("customer_ltv_scores")
              .upsert(chunk, { onConflict: "tenant_id,customer_id" });
            if (error) throw error;
            upserted += chunk.length;
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { scored: upserted });
          return jsonOk({ insights_created: created, scored: upserted });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("LTV predictor failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
