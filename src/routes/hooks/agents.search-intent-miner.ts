/**
 * Search Intent Miner (ported from MFD `acos-search-intent`).
 *
 * Аналізує search_queries: знаходить часті запити з кліком, але без покупки —
 * це сигнал що сторінка/товар не закриває намір. Також знаходить кластери схожих запитів.
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

export const Route = createFileRoute("/hooks/agents/search-intent-miner")({
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

        const handle = await startAgentRun("search-intent-miner", tenantId, ctx);
        try {
          const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
          const { data: queries } = await supabaseAdmin
            .from("search_queries")
            .select("query, clicked, led_to_purchase, result_count")
            .eq("tenant_id", tenantId)
            .gte("occurred_at", since);

          if (!queries?.length) {
            await finishAgentRun(handle, 0, { reason: "no_queries" });
            return jsonOk({ insights_created: 0 });
          }

          // Aggregate by normalized query
          type Agg = {
            q: string;
            total: number;
            clicks: number;
            purchases: number;
            zero: number;
          };
          const agg = new Map<string, Agg>();
          for (const r of queries) {
            const q = r.query.trim().toLowerCase();
            if (!q || q.length < 2) continue;
            const cur = agg.get(q) ?? { q, total: 0, clicks: 0, purchases: 0, zero: 0 };
            cur.total += 1;
            if (r.clicked) cur.clicks += 1;
            if (r.led_to_purchase) cur.purchases += 1;
            if ((r.result_count ?? 0) === 0) cur.zero += 1;
            agg.set(q, cur);
          }

          const all = [...agg.values()];

          // High intent but no conversion: total>=10, clicks/total>=0.5, purchases==0
          const highIntentNoConv = all
            .filter((a) => a.total >= 10 && a.clicks / a.total >= 0.5 && a.purchases === 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

          // Frequent zero results
          const zeroDominant = all
            .filter((a) => a.total >= 5 && a.zero / a.total >= 0.5)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];

          for (const c of highIntentNoConv) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "search_intent_unmet",
              affected_layer: "seo",
              title: `"${c.q}" — клікають, але не купують`,
              description: `${c.total} пошуків, ${c.clicks} кліків, 0 покупок за 30д. Сторінка не відповідає наміру.`,
              expected_impact:
                "Покращення опису/ціни/фото або редирект на правильний продукт може дати 5-15% конверсії.",
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                query: c.q,
                searches_30d: c.total,
                clicks: c.clicks,
                purchases: c.purchases,
              },
              dedup_key: `search-intent-unmet::${c.q}`,
            });
          }

          for (const z of zeroDominant) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "search_zero_results_cluster",
              affected_layer: "catalog",
              title: `"${z.q}" — ${z.zero}/${z.total} пошуків без результату`,
              description: `Гарячий попит без асортименту. Або додай товар, або створи SEO-landing.`,
              expected_impact:
                "Закриття 1 zero-result запиту дає в середньому 3-8 продажів/міс при ціні $30+.",
              confidence: 0.75,
              risk_level: "low",
              metrics: {
                query: z.q,
                zero_results: z.zero,
                total_searches: z.total,
              },
              dedup_key: `search-zero::${z.q}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            unique_queries: agg.size,
            high_intent: highIntentNoConv.length,
            zero_dominant: zeroDominant.length,
          });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Search intent miner failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
