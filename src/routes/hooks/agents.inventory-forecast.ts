/**
 * Inventory Forecast — будує прогноз попиту на 30 днів для кожного товару
 * на основі sales-velocity за останні 60 днів. Записує в `inventory_forecasts`
 * і створює insight, якщо очікуваний stockout наступає раніше за 14 днів.
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

const AGENT_ID = "inventory-forecast";
const WINDOW_DAYS = 60;
const HORIZON_DAYS = 30;
const ALERT_DAYS = 14;

export const Route = createFileRoute("/hooks/agents/inventory-forecast")({
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
          const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

          const [productsRes, itemsRes] = await Promise.all([
            supabaseAdmin
              .from("products")
              .select("id, name, stock, is_active")
              .eq("tenant_id", tenantId)
              .eq("is_active", true),
            supabaseAdmin
              .from("order_items")
              .select("product_id, quantity, created_at, orders!inner(status)")
              .eq("tenant_id", tenantId)
              .gte("created_at", since)
              .limit(50000),
          ]);
          if (productsRes.error) throw productsRes.error;
          if (itemsRes.error) throw itemsRes.error;

          const products = productsRes.data ?? [];
          if (products.length === 0) {
            await finishAgentRun(handle, 0, { reason: "no_products" });
            return jsonOk({ insights_created: 0 });
          }

          // Aggregate sold qty per product (paid orders only)
          const sold = new Map<string, number>();
          for (const it of (itemsRes.data ?? []) as Array<{
            product_id: string | null;
            quantity: number;
            orders: { status: string } | { status: string }[] | null;
          }>) {
            if (!it.product_id) continue;
            const status = Array.isArray(it.orders) ? it.orders[0]?.status : it.orders?.status;
            if (status !== "paid" && status !== "fulfilled") continue;
            sold.set(it.product_id, (sold.get(it.product_id) ?? 0) + (it.quantity ?? 0));
          }

          const today = new Date();
          const forecastDate = new Date(today.getTime() + HORIZON_DAYS * 86_400_000)
            .toISOString()
            .slice(0, 10);

          const upserts: Array<{
            tenant_id: string;
            product_id: string;
            forecast_for_date: string;
            predicted_demand: number;
            predicted_stockout_at: string | null;
            recommended_reorder_qty: number;
            confidence: number;
            computed_at: string;
          }> = [];
          const insights: AgentInsightInput[] = [];

          for (const p of products) {
            const totalSold = sold.get(p.id) ?? 0;
            const dailyVelocity = WINDOW_DAYS > 0 ? totalSold / WINDOW_DAYS : 0;
            const predicted30d = Number.isFinite(dailyVelocity)
              ? Math.max(0, Math.round(dailyVelocity * HORIZON_DAYS))
              : 0;
            const stock = Number.isFinite(p.stock) ? p.stock ?? 0 : 0;

            let stockoutAt: string | null = null;
            if (dailyVelocity > 0 && stock > 0) {
              const daysLeft = stock / dailyVelocity;
              if (daysLeft < 365) {
                stockoutAt = new Date(today.getTime() + daysLeft * 86_400_000).toISOString();
              }
            } else if (dailyVelocity > 0 && stock <= 0) {
              stockoutAt = today.toISOString();
            }

            const reorderQty = Math.max(0, predicted30d - stock);
            const sample = totalSold;
            const confidence = sample >= 30 ? 0.85 : sample >= 10 ? 0.65 : 0.4;

            upserts.push({
              tenant_id: tenantId,
              product_id: p.id,
              forecast_for_date: forecastDate,
              predicted_demand: predicted30d,
              predicted_stockout_at: stockoutAt,
              recommended_reorder_qty: reorderQty,
              confidence,
              computed_at: new Date().toISOString(),
            });

            // Insight only if stockout within 14 days and we have signal
            if (stockoutAt && dailyVelocity > 0 && sample >= 5) {
              const daysLeft = (new Date(stockoutAt).getTime() - today.getTime()) / 86_400_000;
              if (daysLeft <= ALERT_DAYS) {
                insights.push({
                  tenant_id: tenantId,
                  insight_type: "inventory_forecast_warn",
                  affected_layer: "inventory",
                  title: `${p.name}: stockout через ~${Math.max(0, daysLeft).toFixed(1)} дн.`,
                  description: `Velocity ${dailyVelocity.toFixed(2)}/день, залишок ${stock} шт. Прогноз 30д: ${predicted30d} шт. Бракує ~${reorderQty} шт.`,
                  expected_impact: `Поповнення на ${reorderQty} шт. покриє наступні 30 днів і запобігає втраті ~${Math.round(dailyVelocity * Math.max(0, ALERT_DAYS - daysLeft))} продажів.`,
                  confidence,
                  risk_level: daysLeft <= 5 ? "high" : "medium",
                  metrics: {
                    product_id: p.id,
                    product_name: p.name,
                    stock,
                    daily_velocity: dailyVelocity,
                    predicted_demand_30d: predicted30d,
                    days_until_stockout: daysLeft,
                    recommended_reorder_qty: reorderQty,
                    sample_orders: sample,
                  },
                  dedup_key: `inv-forecast::${p.id}::${new Date().toISOString().slice(0, 10)}`,
                });
              }
            }
          }

          // Upsert forecasts in chunks (no unique constraint guaranteed → insert fresh row per run)
          for (let i = 0; i < upserts.length; i += 100) {
            const chunk = upserts.slice(i, i + 100);
            const { error } = await supabaseAdmin.from("inventory_forecasts").insert(chunk);
            if (error) throw error;
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            products: products.length,
            forecasts_written: upserts.length,
            warn_insights: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            products: products.length,
            forecasts: upserts.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Inventory forecast failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
