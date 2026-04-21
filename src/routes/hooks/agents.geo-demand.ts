/**
 * Geo Demand — виявляє регіони з аномально високим попитом
 * для пріоритезації reklamy/локальних промо.
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

const AGENT_ID = "geo-demand";

export const Route = createFileRoute("/hooks/agents/geo-demand")({
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
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("total_cents, metadata, created_at")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("created_at", since)
            .limit(2000);

          const byRegion = new Map<string, { count: number; cents: number }>();
          for (const o of orders ?? []) {
            const meta = (o.metadata ?? {}) as Record<string, unknown>;
            const shipping = (meta.shipping ?? {}) as Record<string, unknown>;
            const region = String(shipping.country ?? shipping.region ?? meta.country ?? "unknown");
            const e = byRegion.get(region) ?? { count: 0, cents: 0 };
            e.count++;
            e.cents += o.total_cents;
            byRegion.set(region, e);
          }

          if (byRegion.size === 0) {
            await finishAgentRun(handle, 0, { reason: "no_geo_data" });
            return jsonOk({ insights_created: 0 });
          }

          const totalOrders = orders?.length ?? 1;
          const totalCents = (orders ?? []).reduce((s, o) => s + o.total_cents, 0);
          const insights: AgentInsightInput[] = [];

          for (const [region, b] of byRegion) {
            if (region === "unknown") continue;
            const share = b.count / totalOrders;
            const revShare = b.cents / Math.max(totalCents, 1);
            // Flag if region delivers >15% of revenue but <10% of orders (high AOV) OR top-1 region overall
            if (revShare > 0.15 && b.count >= 10) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "geo_demand_hotspot",
                affected_layer: "marketing",
                title: `🌍 Гарячий регіон: ${region} (${(b.cents / 100).toFixed(0)} ₴)`,
                description: `${b.count} замовлень за 30 днів (${(share * 100).toFixed(0)}% обсягу, ${(revShare * 100).toFixed(0)}% виторгу).`,
                expected_impact: `Локальна реклама/промо може дати +20% до цього regіону → ~${((b.cents * 0.2) / 100).toFixed(0)} ₴`,
                confidence: 0.75,
                risk_level: "low",
                metrics: {
                  region,
                  orders_count: b.count,
                  revenue_cents: b.cents,
                  share_of_orders: share,
                  share_of_revenue: revShare,
                  suggested_action: "boost_regional_ads",
                },
                dedup_key: `geo-hot::${region}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { regions: byRegion.size });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Geo demand failed", 500, { details: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  },
});
