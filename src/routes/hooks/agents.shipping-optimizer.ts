/**
 * Shipping Optimizer — аналізує метадані замовлень для виявлення
 * найдорожчих/повільних маршрутів доставки і пропонує оптимізацію.
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

const AGENT_ID = "shipping-optimizer";

export const Route = createFileRoute("/hooks/agents/shipping-optimizer")({
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
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const { data: orders, error: ordersErr } = await supabaseAdmin
            .from("orders")
            .select("id, total_cents, metadata, created_at, paid_at")
            .eq("tenant_id", tenantId)
            .in("status", ["paid", "fulfilled"])
            .gte("created_at", since)
            .limit(5000);
          if (ordersErr) throw ordersErr;

          // Aggregate by region/method from metadata.shipping
          const buckets = new Map<
            string,
            { count: number; totalCents: number; deliveryDays: number[] }
          >();
          for (const o of orders ?? []) {
            const meta = (o.metadata ?? {}) as Record<string, unknown>;
            const shipping = (meta.shipping ?? {}) as Record<string, unknown>;
            const region = String(shipping.region ?? shipping.country ?? "unknown");
            const method = String(shipping.method ?? "default");
            const key = `${region}::${method}`;
            const cost = Number(shipping.cost_cents ?? 0);
            const days = Number(shipping.delivery_days ?? 0);
            const b = buckets.get(key) ?? { count: 0, totalCents: 0, deliveryDays: [] };
            b.count++;
            b.totalCents += cost;
            if (days > 0) b.deliveryDays.push(days);
            buckets.set(key, b);
          }

          const insights: AgentInsightInput[] = [];
          for (const [key, b] of buckets) {
            if (b.count < 5) continue;
            const avgCost = b.totalCents / b.count;
            const avgDays =
              b.deliveryDays.length > 0
                ? b.deliveryDays.reduce((s, d) => s + d, 0) / b.deliveryDays.length
                : 0;
            // Flag when avg cost > $15 OR avg delivery > 7 days
            if (avgCost > 1500 || avgDays > 7) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "shipping_inefficiency",
                affected_layer: "fulfillment",
                title: `📦 Дорога/повільна доставка: ${key}`,
                description: `За 30 днів — ${b.count} замовлень. Середня вартість ${(avgCost / 100).toFixed(2)} ₴, доставка ${avgDays.toFixed(1)} дн.`,
                expected_impact:
                  avgCost > 1500
                    ? `Зниження ціни на 15% → економія ~${((avgCost * 0.15 * b.count) / 100).toFixed(0)} ₴/міс`
                    : `Скорочення часу доставки підвищить repeat rate`,
                confidence: 0.7,
                risk_level: "medium",
                metrics: {
                  bucket: key,
                  orders_count: b.count,
                  avg_shipping_cents: Math.round(avgCost),
                  avg_delivery_days: avgDays,
                  suggested_action: avgCost > 1500 ? "negotiate_carrier_rate" : "switch_carrier",
                },
                dedup_key: `shipping::${key}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { buckets: buckets.size });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Shipping optimizer failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
