/**
 * ACOS Agent: Stockout Predictor
 * For each active product computes 14-day units sold velocity and days_of_supply.
 * Threshold: days_of_supply < 7 AND velocity > 0.3 units/day.
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

const AGENT_ID = "stockout_predictor";
const WINDOW_DAYS = 14;

export const Route = createFileRoute("/hooks/agents/stockout")({
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
          const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

          const [productsRes, salesRes] = await Promise.all([
            supabaseAdmin
              .from("products")
              .select("id, name, sku, stock, price_cents, is_active")
              .eq("tenant_id", tenantId)
              .eq("is_active", true)
              .limit(1000),
            supabaseAdmin
              .from("order_items")
              .select(
                "product_id, quantity, unit_price_cents, orders!inner(status, created_at, tenant_id)",
              )
              .eq("tenant_id", tenantId)
              .gte("orders.created_at", since)
              .eq("orders.status", "paid")
              .eq("orders.tenant_id", tenantId)
              .limit(20000),
          ]);
          if (productsRes.error) throw productsRes.error;
          if (salesRes.error) throw salesRes.error;

          // Aggregate units sold per product over the window
          type Item = { product_id: string | null; quantity: number };
          const sold = new Map<string, number>();
          for (const r of (salesRes.data ?? []) as Item[]) {
            if (!r.product_id) continue;
            sold.set(r.product_id, (sold.get(r.product_id) ?? 0) + (r.quantity ?? 0));
          }

          const insights: AgentInsightInput[] = [];
          for (const p of productsRes.data ?? []) {
            const units = sold.get(p.id) ?? 0;
            const velocity = units / WINDOW_DAYS;
            if (velocity <= 0.3) continue; // skip slow movers
            const dos = velocity > 0 ? p.stock / velocity : Infinity;
            if (dos >= 7) continue;
            const lostRevenueCents = Math.round(
              (p.price_cents ?? 0) * velocity * Math.max(0, 7 - dos),
            );
            const confidence = Math.min(
              0.95,
              0.5 + Math.min((7 - dos) / 7, 1) * 0.3 + Math.min(velocity / 5, 1) * 0.15,
            );
            const risk = dos < 2 ? "high" : dos < 4 ? "medium" : "low";
            const reorderQty = Math.max(20, Math.ceil(velocity * 30)); // 30-day cover
            insights.push({
              tenant_id: tenantId,
              insight_type: "stockout_predicted",
              affected_layer: "inventory",
              title: `${p.name}: закінчиться через ~${dos.toFixed(1)} дн. при поточному темпі`,
              description: `Продано ${units} шт. за ${WINDOW_DAYS}д (темп ${velocity.toFixed(2)} шт./день). Залишок: ${p.stock} шт. Замовте ~${reorderQty} шт. на 30 днів. Прогнозоване втрачення виторгу без дій: ~${(lostRevenueCents / 100).toFixed(2)} ₴ за 7 днів.`,
              expected_impact: `Захистити ~${(lostRevenueCents / 100).toFixed(2)} ₴ прогнозованого виторгу`,
              confidence,
              risk_level: risk,
              metrics: {
                product_id: p.id,
                sku: p.sku,
                product_name: p.name,
                stock: p.stock,
                units_sold_14d: units,
                velocity_per_day: Number(velocity.toFixed(3)),
                days_of_supply: Number(dos.toFixed(2)),
                suggested_reorder_qty: reorderQty,
                price_cents: p.price_cents,
                lost_revenue_7d_cents: lostRevenueCents,
                suggested_action: "reorder",
              },
              dedup_key: `product:${p.id}`,
            });
          }

          insights.sort((a, b) => {
            const am = a.metrics as { lost_revenue_7d_cents?: number };
            const bm = b.metrics as { lost_revenue_7d_cents?: number };
            return (bm.lost_revenue_7d_cents ?? 0) - (am.lost_revenue_7d_cents ?? 0);
          });

          const created = await insertInsightsDedup(insights.slice(0, 30));
          await finishAgentRun(handle, created, {
            products_scanned: productsRes.data?.length ?? 0,
            at_risk: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            products_scanned: productsRes.data?.length ?? 0,
            at_risk: insights.length,
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
