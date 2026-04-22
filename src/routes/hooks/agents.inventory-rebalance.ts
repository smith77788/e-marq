/**
 * Inventory Rebalance — знаходить "мертвий запас" (товари, що не продавалися 60+ днів)
 * і пропонує знижку/bundle для розпродажу.
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

const AGENT_ID = "inventory-rebalance";

export const Route = createFileRoute("/hooks/agents/inventory-rebalance")({
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
          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, stock, price_cents")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .gt("stock", 0)
            .limit(500);

          if (!products || products.length === 0) {
            await finishAgentRun(handle, 0, { reason: "no_products" });
            return jsonOk({ insights_created: 0 });
          }

          const productIds = products.map((p) => p.id);
          const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
          const { data: recentSales } = await supabaseAdmin
            .from("order_items")
            .select("product_id, orders!inner(status, created_at)")
            .eq("tenant_id", tenantId)
            .in("product_id", productIds)
            .in("orders.status", ["paid", "fulfilled"])
            .gte("orders.created_at", since);

          const sold = new Set<string>();
          for (const r of recentSales ?? []) {
            if (r.product_id) sold.add(r.product_id);
          }

          const insights: AgentInsightInput[] = [];
          let totalDeadCapital = 0;
          for (const p of products) {
            if (sold.has(p.id)) continue;
            const tied = p.stock * p.price_cents;
            if (tied < 5000) continue; // <$50 ignored
            totalDeadCapital += tied;
            insights.push({
              tenant_id: tenantId,
              insight_type: "dead_stock",
              affected_layer: "inventory",
              title: `🪦 Мертвий запас: ${p.name} (${(tied / 100).toFixed(0)} ₴ заморожено)`,
              description: `${p.stock} шт. на складі, 0 продажів за 60 днів.`,
              expected_impact: `Знижка 25% + bundle може реалізувати запас → ~${((tied * 0.6) / 100).toFixed(0)} ₴`,
              confidence: 0.7,
              risk_level: tied > 50000 ? "high" : "medium",
              metrics: {
                product_id: p.id,
                product_name: p.name,
                stock: p.stock,
                tied_capital_cents: tied,
                suggested_action: "create_clearance_promo",
              },
              dedup_key: `dead-stock::${p.id}`,
            });
          }

          const created = await insertInsightsDedup(insights.slice(0, 10)); // top 10
          await finishAgentRun(handle, created, {
            products_evaluated: products.length,
            dead_capital_cents: totalDeadCapital,
          });
          return jsonOk({ insights_created: created, dead_capital_cents: totalDeadCapital });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Inventory rebalance failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
