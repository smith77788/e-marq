/**
 * Margin Optimizer (ported from MFD `acos-margin-optimizer`).
 *
 * Знаходить продукти з низькою маржею АЛЕ високим volume — і пропонує
 * підняти ціну на 5-10%. Або продукти з негативною маржею (cost > price)
 * і пропонує підняти ціну до беззбитковості + 15%.
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

export const Route = createFileRoute("/hooks/agents/margin-optimizer")({
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

        const handle = await startAgentRun("margin-optimizer", tenantId, ctx);
        try {
          // Step 1: load products + costs
          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);
          if (!products?.length) {
            await finishAgentRun(handle, 0, { reason: "no_products" });
            return jsonOk({ insights_created: 0 });
          }

          const { data: costs } = await supabaseAdmin
            .from("product_costs")
            .select("product_id, cost_cents, shipping_cost_cents, fulfillment_cost_cents")
            .eq("tenant_id", tenantId)
            .is("effective_to", null);
          const costByProduct = new Map<string, number>();
          for (const c of costs ?? []) {
            costByProduct.set(
              c.product_id,
              c.cost_cents + c.shipping_cost_cents + c.fulfillment_cost_cents,
            );
          }

          // Step 2: load 30d order_items to compute volume per product
          const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
          const { data: items } = await supabaseAdmin
            .from("order_items")
            .select("product_id, quantity, unit_price_cents, created_at")
            .eq("tenant_id", tenantId)
            .gte("created_at", since);

          const volumeByProduct = new Map<string, number>();
          for (const it of items ?? []) {
            if (!it.product_id) continue;
            volumeByProduct.set(it.product_id, (volumeByProduct.get(it.product_id) ?? 0) + it.quantity);
          }

          // Step 3: find candidates — high volume + low margin (<25%)
          const insights = [];
          for (const p of products) {
            const totalCost = costByProduct.get(p.id);
            const volume = volumeByProduct.get(p.id) ?? 0;
            if (volume < 5) continue; // need signal

            // Case A: cost unknown → suggest documenting cost (skip for now to avoid noise)
            if (totalCost == null || totalCost === 0) continue;

            const marginCents = p.price_cents - totalCost;
            const marginPct = marginCents / p.price_cents;

            if (marginPct < 0) {
              // Selling below cost — emergency
              const breakeven = totalCost;
              const suggested = Math.round(breakeven * 1.2); // breakeven + 20%
              insights.push({
                tenant_id: tenantId,
                insight_type: "margin_negative",
                affected_layer: "pricing",
                title: `${p.name}: ціна нижче собівартості`,
                description: `Продукт продається у збиток. Втрата ${formatCents(Math.abs(marginCents))} на одиниці.`,
                expected_impact: `Підняття ціни до ${formatCents(suggested)} зупинить збитки і дасть ~25% маржі.`,
                confidence: 0.95,
                risk_level: "high" as const,
                metrics: {
                  product_id: p.id,
                  product_name: p.name,
                  current_price_cents: p.price_cents,
                  total_cost_cents: totalCost,
                  margin_pct: marginPct,
                  margin_cents: marginCents,
                  suggested_price_cents: suggested,
                  volume_30d: volume,
                  monthly_loss_cents: Math.abs(marginCents) * volume,
                },
                dedup_key: `margin_neg::${p.id}`,
              });
            } else if (marginPct < 0.25 && volume >= 10) {
              // Low margin + high volume → suggest +5-10%
              const lift = marginPct < 0.15 ? 0.1 : 0.05;
              const suggested = Math.round(p.price_cents * (1 + lift));
              const expectedExtraMargin = (suggested - p.price_cents) * volume;
              insights.push({
                tenant_id: tenantId,
                insight_type: "margin_low_lift",
                affected_layer: "pricing",
                title: `${p.name}: маржа ${(marginPct * 100).toFixed(0)}% можна підняти`,
                description: `Високий volume (${volume} шт за 30д) + низька маржа = ризик. Невелике підняття ціни не вб'є попит.`,
                expected_impact: `+${formatCents(expectedExtraMargin)} додаткової маржі на місяць.`,
                confidence: 0.7,
                risk_level: "medium" as const,
                metrics: {
                  product_id: p.id,
                  product_name: p.name,
                  current_price_cents: p.price_cents,
                  total_cost_cents: totalCost,
                  margin_pct: marginPct,
                  suggested_price_cents: suggested,
                  lift_pct: lift,
                  volume_30d: volume,
                  expected_monthly_lift_cents: expectedExtraMargin,
                },
                dedup_key: `margin_low::${p.id}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { candidates: insights.length });
          return jsonOk({ insights_created: created, candidates: insights.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Margin optimizer failed", 500, {
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
