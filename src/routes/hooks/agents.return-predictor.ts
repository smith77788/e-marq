/**
 * Return Predictor — виявляє товари з найвищим рівнем повернень/refunds
 * на основі orders.status='refunded' за 60 днів.
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

const AGENT_ID = "return-predictor";

export const Route = createFileRoute("/hooks/agents/return-predictor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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
          const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
          const { data: refundedItems } = await supabaseAdmin
            .from("order_items")
            .select("product_id, product_name, quantity, unit_price_cents, orders!inner(status, created_at)")
            .eq("tenant_id", tenantId)
            .gte("orders.created_at", since)
            .eq("orders.status", "refunded");

          const { data: paidItems } = await supabaseAdmin
            .from("order_items")
            .select("product_id, quantity, orders!inner(status, created_at)")
            .eq("tenant_id", tenantId)
            .gte("orders.created_at", since)
            .in("orders.status", ["paid", "fulfilled", "refunded"]);

          const refundsByProduct = new Map<string, { name: string; qty: number; cents: number }>();
          for (const r of refundedItems ?? []) {
            if (!r.product_id) continue;
            const e = refundsByProduct.get(r.product_id) ?? { name: r.product_name, qty: 0, cents: 0 };
            e.qty += r.quantity;
            e.cents += r.quantity * r.unit_price_cents;
            refundsByProduct.set(r.product_id, e);
          }
          const totalByProduct = new Map<string, number>();
          for (const r of paidItems ?? []) {
            if (!r.product_id) continue;
            totalByProduct.set(r.product_id, (totalByProduct.get(r.product_id) ?? 0) + r.quantity);
          }

          const insights: AgentInsightInput[] = [];
          for (const [pid, data] of refundsByProduct) {
            const total = totalByProduct.get(pid) ?? data.qty;
            const rate = total > 0 ? data.qty / total : 0;
            if (rate < 0.1 || total < 5) continue;
            insights.push({
              tenant_id: tenantId,
              insight_type: "high_return_rate",
              affected_layer: "product",
              title: `↩️ ${data.name}: висока ставка повернень (${(rate * 100).toFixed(0)}%)`,
              description: `${data.qty} з ${total} проданих повернуто за 60 днів. Втрачено $${(data.cents / 100).toFixed(0)}.`,
              expected_impact: `Виправлення опису/якості може повернути ~$${((data.cents * 0.6) / 100).toFixed(0)}/2міс`,
              confidence: 0.75,
              risk_level: rate > 0.2 ? "high" : "medium",
              metrics: {
                product_id: pid,
                product_name: data.name,
                refund_rate: rate,
                refunded_qty: data.qty,
                total_qty: total,
                lost_revenue_cents: data.cents,
                suggested_action: "audit_listing_quality",
              },
              dedup_key: `return-rate::${pid}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { products_evaluated: refundsByProduct.size });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Return predictor failed", 500, { details: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  },
});
