/**
 * Predictive Pricing (ported from MFD `acos-predictive-pricing`).
 *
 * Для кожного активного продукту з достатньою історією замовлень рахує
 * проксі-еластичність попиту через історію price changes у pricing_decisions
 * АБО через volatility продажів. Записує price_elasticity row і пропонує
 * optimal_price_cents = ціна що максимізує revenue.
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
import { loadEffectiveGeoTargets } from "@/lib/acos/loadGeoTargets";
import { rowMatchesGeo, summarizeGeo } from "@/lib/acos/geoTargets";

const AGENT_ID = "predictive-pricing";

export const Route = createFileRoute("/hooks/agents/predictive-pricing")({
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
          const geo = await loadEffectiveGeoTargets(tenantId, AGENT_ID);

          const { data: products, error: productsErr } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);
          if (productsErr) throw productsErr;
          if (!products?.length) {
            await finishAgentRun(handle, 0, { reason: "no_products" });
            return jsonOk({ insights_created: 0 });
          }

          // Load 60d order_items per product (joined with order metadata for geo filter)
          const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
          const { data: itemsRaw, error: itemsErr } = await supabaseAdmin
            .from("order_items")
            .select("product_id, quantity, unit_price_cents, created_at, orders!inner(metadata)")
            .eq("tenant_id", tenantId)
            .gte("created_at", since)
            .not("product_id", "is", null)
            .limit(50000);
          if (itemsErr) throw itemsErr;

          const items = (itemsRaw ?? []).filter((r) => {
            const ord = (r as unknown as { orders?: { metadata?: Record<string, unknown> | null } })
              .orders;
            return rowMatchesGeo({ metadata: ord?.metadata ?? null }, geo);
          });

          // Group by product → list of (price, qty, day)
          const byProduct = new Map<string, { price: number; qty: number; day: string }[]>();
          for (const it of items) {
            if (!it.product_id) continue;
            const list = byProduct.get(it.product_id) ?? [];
            list.push({
              price: it.unit_price_cents,
              qty: it.quantity,
              day: it.created_at.slice(0, 10),
            });
            byProduct.set(it.product_id, list);
          }

          const insights = [];
          for (const p of products) {
            const sales = byProduct.get(p.id) ?? [];
            if (sales.length < 10) continue;

            // Aggregate per (price-bucket of $1, day) → daily qty per price level
            const dailyByPrice = new Map<number, number[]>(); // price → array of daily qty
            const dayMap = new Map<string, Map<number, number>>(); // day → price → qty
            for (const s of sales) {
              const dm = dayMap.get(s.day) ?? new Map();
              dm.set(s.price, (dm.get(s.price) ?? 0) + s.qty);
              dayMap.set(s.day, dm);
            }
            for (const [, dm] of dayMap) {
              for (const [price, qty] of dm) {
                const arr = dailyByPrice.get(price) ?? [];
                arr.push(qty);
                dailyByPrice.set(price, arr);
              }
            }

            // Need at least 2 distinct prices observed
            const pricePoints = [...dailyByPrice.entries()]
              .map(([price, qtys]) => ({
                price,
                avgDaily: qtys.reduce((a, b) => a + b, 0) / qtys.length,
                samples: qtys.length,
              }))
              .filter((pp) => pp.samples >= 2)
              .sort((a, b) => a.price - b.price);

            if (pricePoints.length < 2) continue;

            // Naive elasticity: regress log(q) on log(p) using endpoints
            const lo = pricePoints[0];
            const hi = pricePoints[pricePoints.length - 1];
            if (lo.avgDaily === 0 || hi.avgDaily === 0 || lo.price === hi.price) continue;
            const elasticity =
              (Math.log(hi.avgDaily) - Math.log(lo.avgDaily)) /
              (Math.log(hi.price) - Math.log(lo.price));

            if (!Number.isFinite(elasticity)) continue;

            // Find revenue-maximizing price among observed points
            let best = pricePoints[0];
            let bestRev = best.price * best.avgDaily;
            for (const pp of pricePoints) {
              const rev = pp.price * pp.avgDaily;
              if (rev > bestRev) {
                bestRev = rev;
                best = pp;
              }
            }

            const totalSamples = pricePoints.reduce((s, x) => s + x.samples, 0);
            const confidence = Math.min(0.9, 0.3 + totalSamples / 30);

            // Upsert price_elasticity row
            const { error: upsertErr } = await supabaseAdmin.from("price_elasticity").upsert(
              {
                tenant_id: tenantId,
                product_id: p.id,
                elasticity,
                optimal_price_cents: best.price,
                sample_size: totalSamples,
                data_window_days: 60,
                confidence,
                computed_at: new Date().toISOString(),
              },
              { onConflict: "tenant_id,product_id", ignoreDuplicates: false },
            );
            if (upsertErr) throw upsertErr;

            // Insight only if optimal differs from current by >=5%
            const diffPct = (best.price - p.price_cents) / p.price_cents;
            if (Math.abs(diffPct) < 0.05) continue;
            const direction = diffPct > 0 ? "raise" : "lower";
            const expectedDailyAtNew = best.avgDaily;
            const expectedDailyAtCurrent = lo.avgDaily; // approximate
            const upliftMonthly =
              (best.price * expectedDailyAtNew - p.price_cents * expectedDailyAtCurrent) * 30;

            insights.push({
              tenant_id: tenantId,
              insight_type: "price_predicted_optimal",
              affected_layer: "pricing",
              title: `${p.name}: ${direction === "raise" ? "підняти" : "знизити"} ціну до ${formatCents(best.price)}`,
              description: `Еластичність ${elasticity.toFixed(2)}, оптимальна ціна за історичним revenue.`,
              expected_impact:
                upliftMonthly > 0
                  ? `~${formatCents(upliftMonthly)} додаткового виторгу/міс.`
                  : "Стабілізація виторгу при поточному попиті.",
              confidence,
              risk_level: Math.abs(diffPct) > 0.15 ? ("medium" as const) : ("low" as const),
              metrics: {
                product_id: p.id,
                product_name: p.name,
                current_price_cents: p.price_cents,
                suggested_price_cents: best.price,
                elasticity,
                price_points: pricePoints,
                samples: totalSamples,
                expected_monthly_uplift_cents: Math.round(upliftMonthly),
              },
              dedup_key: `price_pred::${p.id}::${best.price}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            products_analyzed: byProduct.size,
            geo: summarizeGeo(geo, "uk"),
            items_in_scope: items.length,
          });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Predictive pricing failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `${(c / 100).toFixed(c >= 1000 ? 0 : 2)} ₴`;
}
