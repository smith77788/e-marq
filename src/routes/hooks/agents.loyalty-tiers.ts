/**
 * Loyalty Tiers (ported from MFD `acos-loyalty-tiers`).
 *
 * Аналізує LTV-розподіл клієнтів і пропонує threshold для Bronze/Silver/Gold/Platinum,
 * щоб ~50/30/15/5% клієнтів попадали в кожен tier (галаус-розподіл).
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

export const Route = createFileRoute("/hooks/agents/loyalty-tiers")({
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

        const handle = await startAgentRun("loyalty-tiers", tenantId, ctx);
        try {
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select("total_spent_cents")
            .eq("tenant_id", tenantId)
            .gt("total_spent_cents", 0);

          if (!customers || customers.length < 20) {
            await finishAgentRun(handle, 0, {
              reason: "insufficient_data",
              n: customers?.length ?? 0,
            });
            return jsonOk({ insights_created: 0 });
          }

          const spent = customers.map((c) => c.total_spent_cents ?? 0).sort((a, b) => a - b);
          const n = spent.length;

          // Percentile thresholds (ascending): bronze=below p50, silver=p50..p80, gold=p80..p95, platinum=p95+
          const p50 = spent[Math.floor(n * 0.5)];
          const p80 = spent[Math.floor(n * 0.8)];
          const p95 = spent[Math.floor(n * 0.95)];

          const counts = {
            bronze: spent.filter((s) => s < p50).length,
            silver: spent.filter((s) => s >= p50 && s < p80).length,
            gold: spent.filter((s) => s >= p80 && s < p95).length,
            platinum: spent.filter((s) => s >= p95).length,
          };

          const insights: Parameters<typeof insertInsightsDedup>[0] = [
            {
              tenant_id: tenantId!,
              insight_type: "loyalty_tier_proposal",
              affected_layer: "lifecycle",
              title: `Loyalty-tiers: 4 рівня готові до запуску`,
              description: `Аналіз LTV ${n} клієнтів дає природні breakpoints для Bronze/Silver/Gold/Platinum.`,
              expected_impact:
                'Запуск tier-програми зазвичай підвищує retention на 10-20% через "статусний" ефект.',
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                bronze_threshold_cents: 0,
                silver_threshold_cents: p50,
                gold_threshold_cents: p80,
                platinum_threshold_cents: p95,
                bronze_count: counts.bronze,
                silver_count: counts.silver,
                gold_count: counts.gold,
                platinum_count: counts.platinum,
                total_customers: n,
              },
              dedup_key: `loyalty-tiers::${new Date().toISOString().slice(0, 7)}`,
            },
          ];

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { tier_thresholds: { p50, p80, p95 } });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Loyalty tiers failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
