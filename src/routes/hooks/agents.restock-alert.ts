/**
 * Restock Alert — короткостроковий "червоний прапорець" для товарів
 * з критично низьким залишком (≤ recommended_reorder_qty / 3) АБО
 * тих, що вже мають свіжий inventory_forecast із stockout ≤ 7 днів.
 *
 * Це доповнення до stockout/inventory-forecast: фокус на негайних діях.
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
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "restock-alert";
const URGENT_DAYS = 7;

export const Route = createFileRoute("/hooks/agents/restock-alert")({
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
          // Use latest forecast per product (within last 2 days)
          const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
          const { data: forecasts, error: fErr } = await supabaseAdmin
            .from("inventory_forecasts")
            .select("product_id, predicted_stockout_at, recommended_reorder_qty, computed_at")
            .eq("tenant_id", tenantId)
            .gte("computed_at", since)
            .order("computed_at", { ascending: false });
          if (fErr) throw fErr;

          // Keep most recent per product
          const latestPerProduct = new Map<
            string,
            { stockoutAt: string | null; reorderQty: number }
          >();
          for (const f of forecasts ?? []) {
            if (!f.product_id) continue;
            if (!latestPerProduct.has(f.product_id)) {
              latestPerProduct.set(f.product_id, {
                stockoutAt: f.predicted_stockout_at,
                reorderQty: f.recommended_reorder_qty ?? 0,
              });
            }
          }

          if (latestPerProduct.size === 0) {
            await finishAgentRun(handle, 0, { reason: "no_recent_forecasts" });
            return jsonOk({ insights_created: 0, hint: "run inventory-forecast first" });
          }

          // Pull product info
          const productIds = Array.from(latestPerProduct.keys());
          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, stock, price_cents")
            .eq("tenant_id", tenantId)
            .in("id", productIds);

          const insights: AgentInsightInput[] = [];
          const now = Date.now();
          for (const p of products ?? []) {
            const f = latestPerProduct.get(p.id);
            if (!f?.stockoutAt) continue;
            const daysLeft = (new Date(f.stockoutAt).getTime() - now) / 86_400_000;
            if (daysLeft > URGENT_DAYS) continue;

            const reorder = Math.max(f.reorderQty, 1);
            const lostRevenue = Math.round(reorder * (p.price_cents ?? 0));
            insights.push({
              tenant_id: tenantId,
              insight_type: "restock_alert_urgent",
              affected_layer: "inventory",
              title: `🚨 ${p.name}: терміновий restock (${Math.max(0, daysLeft).toFixed(1)} дн.)`,
              description: `Залишок ${p.stock} шт. Без поповнення товар закінчиться за ≤ ${URGENT_DAYS} днів.`,
              expected_impact: `Замовлення ${reorder} шт. зберігає ~${formatCents(lostRevenue)} виторгу.`,
              confidence: 0.9,
              risk_level: daysLeft <= 2 ? "high" : "medium",
              metrics: {
                product_id: p.id,
                product_name: p.name,
                stock: p.stock,
                days_until_stockout: daysLeft,
                recommended_reorder_qty: reorder,
                potential_lost_revenue_cents: lostRevenue,
                suggested_action: "create_reorder_po",
              },
              dedup_key: `restock-urgent::${p.id}::${new Date().toISOString().slice(0, 10)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            forecasts_evaluated: latestPerProduct.size,
            urgent: insights.length,
          });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Restock alert failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `${(c / 100).toFixed(c >= 1000 ? 0 : 2)} ₴`;
}
