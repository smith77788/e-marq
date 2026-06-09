/**
 * ACOS Agent: Search Gap Detector
 * Reads /search content_viewed events for last 30 days, finds queries with
 * results_count = 0 — flags as catalog/SEO opportunity.
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

const AGENT_ID = "search_gap_detector";

type EvRow = {
  type: string;
  payload: { path?: string; search_term?: string; results_count?: number } | null;
  created_at: string;
};

export const Route = createFileRoute("/hooks/agents/search-gap")({
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
          const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("events")
            .select("type, payload, created_at")
            .eq("tenant_id", tenantId)
            .eq("type", "content_viewed")
            .gte("created_at", since)
            .limit(20000);
          if (error) throw error;

          const tally = new Map<string, { hits: number; misses: number }>();
          for (const r of (data ?? []) as EvRow[]) {
            const term = r.payload?.search_term?.trim().toLowerCase();
            if (!term) continue;
            const isMiss = (r.payload?.results_count ?? -1) === 0;
            const cur = tally.get(term) ?? { hits: 0, misses: 0 };
            if (isMiss) cur.misses++;
            else cur.hits++;
            tally.set(term, cur);
          }

          const insights: AgentInsightInput[] = [];
          let totalSearches = 0;
          let zeroResultSearches = 0;
          for (const [term, t] of tally.entries()) {
            totalSearches += t.hits + t.misses;
            zeroResultSearches += t.misses;
            const total = t.hits + t.misses;
            const missRate = total > 0 ? t.misses / total : 0;
            if (t.misses < 3) continue; // skip noise
            if (missRate < 0.5) continue; // mostly hits — not a gap
            const confidence = Math.min(
              0.9,
              0.5 + Math.min(t.misses / 30, 1) * 0.3 + missRate * 0.1,
            );
            const risk = t.misses > 20 ? "high" : t.misses > 8 ? "medium" : "low";
            insights.push({
              tenant_id: tenantId,
              insight_type: "search_gap",
              affected_layer: "search",
              title: `"${term}" — ${t.misses} пошуків без результату`,
              description: `Відвідувачі шукали "${term}" ${total} разів за 30 днів; ${t.misses} запитів не дали результату (${(missRate * 100).toFixed(0)}% miss rate). Розгляньте додавання товару, редірект на пов'язану категорію або SEO-лендінг під цей запит.`,
              expected_impact: `Перехопити попит від ~${t.misses}/міс кваліфікованих відвідувачів`,
              confidence,
              risk_level: risk,
              metrics: {
                search_term: term,
                searches_total: total,
                searches_zero_results: t.misses,
                miss_rate: Number(missRate.toFixed(3)),
                suggested_action: "add_product_or_seo_page",
              },
              dedup_key: `term:${term}`,
            });
          }

          insights.sort((a, b) => {
            const am = a.metrics as { searches_zero_results?: number };
            const bm = b.metrics as { searches_zero_results?: number };
            return (bm.searches_zero_results ?? 0) - (am.searches_zero_results ?? 0);
          });

          const created = await insertInsightsDedup(insights.slice(0, 25));
          await finishAgentRun(handle, created, {
            unique_terms: tally.size,
            total_searches: totalSearches,
            zero_result_searches: zeroResultSearches,
          });
          return jsonOk({
            run_id: handle.runId,
            unique_terms: tally.size,
            zero_result_searches: zeroResultSearches,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
