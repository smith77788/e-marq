/**
 * Bootstrap Agent: Margin Estimator
 *
 * Намагається оцінити маржу для кожного активного товару:
 *   1. Якщо metadata.cost_cents → margin = price - cost (висока точність)
 *   2. Інакше → дивимося на ціновий сегмент із bootstrap_facts.brand_profile
 *      та галузеві бенчмарки (food: 35-50%, fashion: 50-65%, beauty: 60-75%)
 * Пише per-product margin_estimate + загальний margin_summary у bootstrap_facts.
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
import { readBootstrapFact, upsertBootstrapFacts, type BootstrapFactInput } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "margin_estimator";

const TIER_DEFAULT_MARGIN: Record<string, number> = {
  budget: 0.25,
  mid: 0.4,
  premium: 0.55,
  luxury: 0.65,
};

type Row = {
  id: string;
  name: string;
  price_cents: number | null;
  metadata: Record<string, unknown> | null;
};

export const Route = createFileRoute("/hooks/agents/margin-estimator")({
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
          const profile = await readBootstrapFact<{ price_tier?: string }>(tenantId, "brand_profile");
          const tier = profile?.price_tier ?? "mid";
          const fallbackMargin = TIER_DEFAULT_MARGIN[tier] ?? 0.4;

          const { data, error } = await supabaseAdmin
            .from("products")
            .select("id, name, price_cents, metadata")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .limit(500);
          if (error) throw error;
          const rows = (data ?? []) as Row[];

          let measuredCount = 0;
          let estimatedCount = 0;
          let totalMarginPct = 0;
          let weightedTotal = 0;
          const facts: BootstrapFactInput[] = [];

          for (const r of rows) {
            if (!r.price_cents || r.price_cents <= 0) continue;
            const meta = (r.metadata ?? {}) as Record<string, unknown>;
            const cost = typeof meta.cost_cents === "number" ? meta.cost_cents : null;
            let marginPct: number;
            let source: "measured" | "estimated";
            if (cost !== null && cost > 0 && cost < r.price_cents) {
              marginPct = (r.price_cents - cost) / r.price_cents;
              source = "measured";
              measuredCount++;
            } else {
              marginPct = fallbackMargin;
              source = "estimated";
              estimatedCount++;
            }
            totalMarginPct += marginPct;
            weightedTotal += marginPct * r.price_cents;
            facts.push({
              tenant_id: tenantId,
              fact_kind: "margin_estimate",
              fact_key: r.id,
              value: {
                product_id: r.id,
                product_name: r.name,
                price_cents: r.price_cents,
                cost_cents: cost,
                margin_pct: Number(marginPct.toFixed(4)),
                margin_cents: Math.round(r.price_cents * marginPct),
                source,
              },
              confidence: source === "measured" ? 0.95 : 0.5,
            });
          }

          const totalProducts = measuredCount + estimatedCount;
          const avgMarginPct = totalProducts > 0 ? totalMarginPct / totalProducts : 0;
          const weightedAvgMarginPct =
            totalProducts > 0
              ? weightedTotal / rows.reduce((s, r) => s + (r.price_cents ?? 0), 0)
              : 0;

          facts.push({
            tenant_id: tenantId,
            fact_kind: "margin_summary",
            value: {
              avg_margin_pct: Number(avgMarginPct.toFixed(4)),
              weighted_avg_margin_pct: Number(weightedAvgMarginPct.toFixed(4)),
              measured_count: measuredCount,
              estimated_count: estimatedCount,
              tier_assumption: tier,
              fallback_margin_pct: fallbackMargin,
            },
            confidence: measuredCount > 0 ? 0.85 : 0.5,
          });

          if (facts.length > 0) await upsertBootstrapFacts(facts);

          const insights: AgentInsightInput[] = [];
          if (measuredCount === 0 && estimatedCount > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_margin_unknown",
              affected_layer: "finance",
              title: "Margins are estimated, not measured",
              description: `Жоден з ${estimatedCount} активних SKU не має cost_cents у metadata. Margin-агенти зараз оцінюють маржу за галузевим середнім (${(fallbackMargin * 100).toFixed(0)}% для tier="${tier}"). Додайте реальну собівартість, щоб промо/discount-агенти не зробили збиткову акцію.`,
              expected_impact: "Виключає ризик збиткових промо-акцій",
              confidence: 0.9,
              risk_level: "high",
              metrics: { products: estimatedCount, fallback_margin_pct: fallbackMargin, action: "fill_cost_cents" },
              dedup_key: "margin_unknown_all",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            measured: measuredCount,
            estimated: estimatedCount,
            avg_margin_pct: avgMarginPct,
          });
          return jsonOk({
            run_id: handle.runId,
            insights_created: created,
            avg_margin_pct: avgMarginPct,
            measured: measuredCount,
            estimated: estimatedCount,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Margin estimator failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
