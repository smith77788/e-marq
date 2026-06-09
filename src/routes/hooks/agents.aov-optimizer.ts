/**
 * AOV / Conversion-leak agent.
 *
 * Looks at last 30 days. For each product:
 *   views = count(events.product_viewed where product_id = X)
 *   carts = count(events.add_to_cart where product_id = X)
 *   purchases = sum(order_items.quantity where product_id = X AND orders.status = paid)
 *
 * Flags products with views > 30 AND carts/views < 0.05 (low engagement)
 * OR carts > 10 AND purchases/carts < 0.2 (cart abandon).
 *
 * Inserts ai_insights with concrete metric so owner can act.
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

const AGENT_ID = "aov_optimizer";

export const Route = createFileRoute("/hooks/agents/aov-optimizer")({
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
          const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents, stock, is_active")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);

          const { data: viewEvents } = await supabaseAdmin
            .from("events")
            .select("product_id")
            .eq("tenant_id", tenantId)
            .eq("type", "product_viewed")
            .gte("created_at", since)
            .limit(100000);
          const { data: cartEvents } = await supabaseAdmin
            .from("events")
            .select("product_id")
            .eq("tenant_id", tenantId)
            .eq("type", "add_to_cart")
            .gte("created_at", since)
            .limit(100000);

          const viewCount: Record<string, number> = {};
          const cartCount: Record<string, number> = {};
          for (const e of viewEvents ?? [])
            if (e.product_id) viewCount[e.product_id] = (viewCount[e.product_id] ?? 0) + 1;
          for (const e of cartEvents ?? [])
            if (e.product_id) cartCount[e.product_id] = (cartCount[e.product_id] ?? 0) + 1;

          const { data: items } = await supabaseAdmin
            .from("order_items")
            .select("product_id, quantity, orders!inner(status, created_at)")
            .eq("tenant_id", tenantId)
            .in("orders.status", ["paid", "fulfilled"])
            .gte("orders.created_at", since);
          const purchaseCount: Record<string, number> = {};
          for (const it of items ?? []) {
            if (it.product_id)
              purchaseCount[it.product_id] =
                (purchaseCount[it.product_id] ?? 0) + (it.quantity ?? 1);
          }

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];
          for (const p of products ?? []) {
            const v = viewCount[p.id] ?? 0;
            const c = cartCount[p.id] ?? 0;
            const pu = purchaseCount[p.id] ?? 0;

            if (v >= 30 && c / Math.max(v, 1) < 0.05) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "low_engagement_product",
                affected_layer: "catalogue",
                title: `"${p.name}": багато переглядів, мало кошиків`,
                description: `${v} переглядів vs ${c} додавань до кошика за 30д (${((c / Math.max(v, 1)) * 100).toFixed(1)}%). Можливо, потрібно краще фото, чіткіший опис або зміна ціни.`,
                expected_impact: `Підняти конверсію до 8% → ~${Math.round((v * 0.08 - c) * (p.price_cents / 100))} ₴ додаткового виторгу/міс`,
                confidence: 0.7,
                risk_level: "low",
                metrics: {
                  product_id: p.id,
                  product_name: p.name,
                  views: v,
                  carts: c,
                  purchases: pu,
                  ctr: c / Math.max(v, 1),
                },
                dedup_key: `low_engagement::${p.id}`,
              });
            }
            if (c >= 10 && pu / Math.max(c, 1) < 0.2) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "cart_abandon",
                affected_layer: "checkout",
                title: `"${p.name}": часто покидають кошик`,
                description: `${c} додавань до кошика → лише ${pu} покупок (${((pu / Math.max(c, 1)) * 100).toFixed(1)}%). Тертя при оформленні, шок від вартості доставки або брак довіри.`,
                expected_impact: `Повернення 30% кошиків = ~${Math.max(0, Math.round((c * 0.3 - pu) * (p.price_cents / 100)))} ₴ додаткового виторгу`,
                confidence: 0.75,
                risk_level: "medium",
                metrics: {
                  product_id: p.id,
                  product_name: p.name,
                  views: v,
                  carts: c,
                  purchases: pu,
                  conversion: pu / Math.max(c, 1),
                },
                dedup_key: `cart_abandon::${p.id}`,
              });
            }
          }

          const inserted = await insertInsightsDedup(insights);
          await finishAgentRun(handle, inserted, {
            products_evaluated: products?.length ?? 0,
            candidates: insights.length,
          });
          return jsonOk({ inserted, candidates: insights.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("AOV optimizer failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
