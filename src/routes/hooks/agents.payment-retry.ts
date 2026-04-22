/**
 * Payment Retry — знаходить замовлення зі статусом pending/failed,
 * де платіж не пройшов, і пропонує retry з іншим методом.
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

const AGENT_ID = "payment-retry";

export const Route = createFileRoute("/hooks/agents/payment-retry")({
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
          const { data: stuck } = await supabaseAdmin
            .from("orders")
            .select(
              "id, total_cents, customer_email, customer_name, payment_method, created_at, status",
            )
            .eq("tenant_id", tenantId)
            .eq("status", "pending")
            .gte("created_at", since)
            .order("total_cents", { ascending: false })
            .limit(50);

          const insights: AgentInsightInput[] = [];
          let totalRecoverable = 0;
          for (const o of stuck ?? []) {
            const ageHours = (Date.now() - new Date(o.created_at).getTime()) / 3_600_000;
            if (ageHours < 1) continue; // give grace period
            totalRecoverable += o.total_cents;
            insights.push({
              tenant_id: tenantId,
              insight_type: "payment_retry_opportunity",
              affected_layer: "checkout",
              title: `💳 Платіж застряг: ${(o.total_cents / 100).toFixed(2)} ₴ (${o.customer_name ?? o.customer_email ?? "guest"})`,
              description: `Замовлення pending ${ageHours.toFixed(0)}h. Метод: ${o.payment_method}.`,
              expected_impact: `Retry або alt. метод відновлює ~30% таких замовлень → ~${((o.total_cents * 0.3) / 100).toFixed(2)} ₴`,
              confidence: 0.65,
              risk_level: o.total_cents > 5000 ? "high" : "medium",
              metrics: {
                order_id: o.id,
                amount_cents: o.total_cents,
                hours_pending: ageHours,
                payment_method: o.payment_method,
                customer_email: o.customer_email,
                suggested_action: "send_payment_retry_link",
              },
              dedup_key: `payment-retry::${o.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            stuck_orders: stuck?.length ?? 0,
            recoverable_cents: totalRecoverable,
          });
          return jsonOk({ insights_created: created, recoverable_cents: totalRecoverable });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Payment retry failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
