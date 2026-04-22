/**
 * SEO Rewriter (ported from MFD `acos-seo-rewriter`).
 *
 * Знаходить content_pages з низькою CTR (impressions>=100, ctr<2%) або без seo_title,
 * та пропонує переписати title/description.
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

export const Route = createFileRoute("/hooks/agents/seo-rewriter")({
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

        const handle = await startAgentRun("seo-rewriter", tenantId, ctx);
        try {
          // Pull last 30d performance per page
          const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const { data: perf } = await supabaseAdmin
            .from("content_performance")
            .select("page_id, search_impressions, search_clicks")
            .eq("tenant_id", tenantId)
            .gte("measured_on", since);

          const agg = new Map<string, { impr: number; clicks: number }>();
          for (const p of perf ?? []) {
            if (!p.page_id) continue;
            const cur = agg.get(p.page_id) ?? { impr: 0, clicks: 0 };
            cur.impr += p.search_impressions ?? 0;
            cur.clicks += p.search_clicks ?? 0;
            agg.set(p.page_id, cur);
          }

          const { data: pages } = await supabaseAdmin
            .from("content_pages")
            .select("id, slug, title, seo_title, seo_description, content_type")
            .eq("tenant_id", tenantId)
            .eq("is_published", true);

          const candidates: {
            id: string;
            slug: string;
            title: string;
            impressions: number;
            clicks: number;
            ctr: number;
            reason: "low_ctr" | "missing_seo";
          }[] = [];

          for (const p of pages ?? []) {
            const stats = agg.get(p.id) ?? { impr: 0, clicks: 0 };
            const ctr = stats.impr > 0 ? stats.clicks / stats.impr : 0;
            const missingSeo = !p.seo_title || !p.seo_description;
            const lowCtr = stats.impr >= 100 && ctr < 0.02;
            if (!missingSeo && !lowCtr) continue;
            candidates.push({
              id: p.id,
              slug: p.slug,
              title: p.title,
              impressions: stats.impr,
              clicks: stats.clicks,
              ctr,
              reason: lowCtr ? "low_ctr" : "missing_seo",
            });
          }

          // Sort by traffic loss potential (impressions desc)
          candidates.sort((a, b) => b.impressions - a.impressions);

          const insights = candidates.slice(0, 10).map((c) => ({
            tenant_id: tenantId!,
            insight_type: "seo_rewrite_opportunity",
            affected_layer: "seo",
            title:
              c.reason === "low_ctr"
                ? `Низький CTR на /${c.slug}: ${(c.ctr * 100).toFixed(2)}%`
                : `Не заповнено SEO для /${c.slug}`,
            description:
              c.reason === "low_ctr"
                ? `${c.impressions} показів, лише ${c.clicks} кліків. Title/description можна переписати.`
                : `Сторінка опублікована без seo_title або seo_description — Google показує власну версію.`,
            expected_impact:
              c.reason === "low_ctr"
                ? `+30-60% CTR при кращому title/description = +${Math.round(c.impressions * 0.01)} кліків/міс.`
                : `Заповнений SEO дає +20-40% органіки на новій сторінці.`,
            confidence: c.reason === "low_ctr" ? 0.75 : 0.85,
            risk_level: "low" as const,
            metrics: {
              page_id: c.id,
              slug: c.slug,
              current_title: c.title,
              impressions_30d: c.impressions,
              clicks_30d: c.clicks,
              ctr: c.ctr,
              reason: c.reason,
            },
            dedup_key: `seo-rewrite::${c.id}::${c.reason}`,
          }));

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            candidates: candidates.length,
            pages_analyzed: pages?.length ?? 0,
          });
          return jsonOk({ insights_created: created, candidates: candidates.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("SEO rewriter failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
