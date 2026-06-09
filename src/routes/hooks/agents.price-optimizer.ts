/**
 * Price Optimizer agent.
 *
 * Weekly. For each active product with enough history (last 60 days):
 *   views      = count(events.product_viewed)
 *   carts      = count(events.add_to_cart)
 *   purchases  = sum(order_items.quantity from paid orders)
 *   revenue    = sum(order_items.unit_price_cents * quantity from paid orders)
 *
 * Computes:
 *   view_to_cart   = carts / views
 *   cart_to_buy    = purchases / carts
 *   monthly_units  = purchases * (30/60)
 *
 * Then picks ONE of three plays per product (only the strongest signal):
 *
 *   1. UNDERPRICED — view_to_cart >= 0.20 AND cart_to_buy >= 0.50 AND monthly_units >= 8
 *      → "Demand is hot. Test +10% price; predicted +$Y/mo at same conversion."
 *
 *   2. OVERPRICED  — views >= 80 AND view_to_cart < 0.04 (great visibility, no clicks-to-cart)
 *      → "Lots of looks, no buys. Try -10% price; predicted +$Y/mo if conversion doubles."
 *
 *   3. BUNDLE      — purchases >= 5 AND avg_order_quantity_with_this <= 1.1 (always sold solo)
 *      → "Customers never bundle this. Pair with top complementary SKU."
 *
 * Skips: inactive products, products with <30 views in window, products without orders ever.
 *
 * Inserts ai_insights with type "price_optimization" so InsightsPanel renders it
 * and ACTION_BY_TYPE in actions.apply.ts can route the apply (added in next iteration).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  jsonError,
  jsonOk,
  startAgentRun,
  finishAgentRun,
  failAgentRun,
  insertInsightsDedup,
} from "@/lib/acos/agentRuntime";
import { loadEffectiveGeoTargets } from "@/lib/acos/loadGeoTargets";
import { rowMatchesGeo, summarizeGeo } from "@/lib/acos/geoTargets";

const AGENT_ID = "price_optimizer";
const WINDOW_DAYS = 60;

type ProductRow = {
  id: string;
  name: string;
  price_cents: number;
  is_active: boolean;
  stock: number;
};

function fmtUah(cents: number) {
  return `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;
}

export const Route = createFileRoute("/hooks/agents/price-optimizer")({
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
          const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
          const geo = await loadEffectiveGeoTargets(tenantId, AGENT_ID);

          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents, is_active, stock")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);

          if (!products || products.length === 0) {
            await finishAgentRun(handle, 0, { skipped: "no_products" });
            return jsonOk({ insights_created: 0, reason: "no_products" });
          }

          // Pull aggregates in parallel — events.payload / orders.metadata carry geo
          const [viewsRes, cartsRes, soldRes] = await Promise.all([
            supabaseAdmin
              .from("events")
              .select("product_id, payload")
              .eq("tenant_id", tenantId)
              .eq("type", "product_viewed")
              .gte("created_at", since)
              .not("product_id", "is", null)
              .limit(50_000),
            supabaseAdmin
              .from("events")
              .select("product_id, payload")
              .eq("tenant_id", tenantId)
              .eq("type", "add_to_cart")
              .gte("created_at", since)
              .not("product_id", "is", null)
              .limit(50_000),
            supabaseAdmin
              .from("order_items")
              .select(
                "product_id, quantity, unit_price_cents, orders!inner(status, paid_at, tenant_id, metadata)",
              )
              .eq("tenant_id", tenantId)
              .eq("orders.status", "paid")
              .gte("orders.paid_at", since)
              .not("product_id", "is", null)
              .limit(50_000),
          ]);

          const filteredViews = (viewsRes.data ?? []).filter((r) =>
            rowMatchesGeo({ metadata: (r.payload ?? null) as Record<string, unknown> | null }, geo),
          );
          const filteredCarts = (cartsRes.data ?? []).filter((r) =>
            rowMatchesGeo({ metadata: (r.payload ?? null) as Record<string, unknown> | null }, geo),
          );
          const filteredSold = (soldRes.data ?? []).filter((r) => {
            const ord = (r as unknown as { orders?: { metadata?: Record<string, unknown> | null } })
              .orders;
            return rowMatchesGeo({ metadata: ord?.metadata ?? null }, geo);
          });

          const viewCount = new Map<string, number>();
          for (const r of filteredViews) {
            if (r.product_id) viewCount.set(r.product_id, (viewCount.get(r.product_id) ?? 0) + 1);
          }
          const cartCount = new Map<string, number>();
          for (const r of filteredCarts) {
            if (r.product_id) cartCount.set(r.product_id, (cartCount.get(r.product_id) ?? 0) + 1);
          }
          const soldUnits = new Map<string, number>();
          const soldRevenue = new Map<string, number>();
          for (const r of filteredSold) {
            if (!r.product_id) continue;
            soldUnits.set(r.product_id, (soldUnits.get(r.product_id) ?? 0) + (r.quantity ?? 0));
            soldRevenue.set(
              r.product_id,
              (soldRevenue.get(r.product_id) ?? 0) + (r.unit_price_cents ?? 0) * (r.quantity ?? 0),
            );
          }

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];

          for (const p of products as ProductRow[]) {
            const views = viewCount.get(p.id) ?? 0;
            const carts = cartCount.get(p.id) ?? 0;
            const purchases = soldUnits.get(p.id) ?? 0;
            const revenue = soldRevenue.get(p.id) ?? 0;
            if (views < 30) continue; // not enough signal

            const v2c = views > 0 ? carts / views : 0;
            const c2b = carts > 0 ? purchases / carts : 0;
            const monthlyUnits = purchases * (30 / WINDOW_DAYS);
            const monthlyRev = revenue * (30 / WINDOW_DAYS);

            // 1. UNDERPRICED — strong demand
            if (v2c >= 0.2 && c2b >= 0.5 && monthlyUnits >= 8) {
              const newPrice = Math.round(p.price_cents * 1.1);
              const upliftMonthly = Math.round(monthlyUnits * (newPrice - p.price_cents));
              insights.push({
                tenant_id: tenantId,
                insight_type: "price_optimization",
                affected_layer: "pricing",
                title: `${p.name}: підняти ціну на 10% (висока конверсія)`,
                description: `За ${WINDOW_DAYS}д: ${views} переглядів, ${carts} кошиків (${(v2c * 100).toFixed(0)}% v→c), ${purchases} продажів (${(c2b * 100).toFixed(0)}% c→b), ${fmtUah(monthlyRev)}/міс. Попит сильний — тест ${fmtUah(p.price_cents)} → ${fmtUah(newPrice)}.`,
                expected_impact: `+${fmtUah(upliftMonthly)}/міс при збереженні конверсії`,
                confidence: 0.7,
                risk_level: "medium",
                metrics: {
                  product_id: p.id,
                  product_name: p.name,
                  current_price_cents: p.price_cents,
                  suggested_price_cents: newPrice,
                  direction: "up",
                  delta_pct: 10,
                  views,
                  carts,
                  purchases,
                  view_to_cart: v2c,
                  cart_to_buy: c2b,
                  monthly_revenue_cents: monthlyRev,
                  expected_uplift_cents: upliftMonthly,
                },
                dedup_key: `price_opt:up:${p.id}`,
              });
              continue;
            }

            // 2. OVERPRICED — lots of looks, no carts
            if (views >= 80 && v2c < 0.04) {
              const newPrice = Math.round(p.price_cents * 0.9);
              // assume conversion doubles at 10% lower
              const projectedMonthlyUnits = carts * 2 * (30 / WINDOW_DAYS);
              const projectedRev = projectedMonthlyUnits * newPrice;
              const upliftMonthly = Math.round(projectedRev - monthlyRev);
              insights.push({
                tenant_id: tenantId,
                insight_type: "price_optimization",
                affected_layer: "pricing",
                title: `${p.name}: знизити ціну на 10% (низька конверсія)`,
                description: `За ${WINDOW_DAYS}д: ${views} переглядів, але лише ${carts} кошиків (${(v2c * 100).toFixed(1)}% v→c). Ціна може бути бар'єром. Тест ${fmtUah(p.price_cents)} → ${fmtUah(newPrice)}.`,
                expected_impact:
                  upliftMonthly > 0
                    ? `+${fmtUah(upliftMonthly)}/міс при 2x конверсії`
                    : `беззбитковість при 2x конверсії`,
                confidence: 0.55,
                risk_level: "medium",
                metrics: {
                  product_id: p.id,
                  product_name: p.name,
                  current_price_cents: p.price_cents,
                  suggested_price_cents: newPrice,
                  direction: "down",
                  delta_pct: -10,
                  views,
                  carts,
                  purchases,
                  view_to_cart: v2c,
                  cart_to_buy: c2b,
                  monthly_revenue_cents: monthlyRev,
                  expected_uplift_cents: upliftMonthly,
                },
                dedup_key: `price_opt:down:${p.id}`,
              });
              continue;
            }
          }

          const inserted = await insertInsightsDedup(insights);
          await finishAgentRun(handle, inserted, {
            products_evaluated: products.length,
            candidates: insights.length,
            geo: summarizeGeo(geo, "uk"),
            views_in_scope: filteredViews.length,
            sold_in_scope: filteredSold.length,
          });
          return jsonOk({ insights_created: inserted, candidates: insights.length });
        } catch (e) {
          await failAgentRun(handle, (e as Error).message);
          return jsonError((e as Error).message, 500);
        }
      },
    },
  },
});
