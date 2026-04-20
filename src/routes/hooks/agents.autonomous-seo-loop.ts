/**
 * Autonomous SEO Loop — оцінює ROI agent_generated content_pages.
 * Для кожної опублікованої agent-сторінки за останні 60 днів дивиться
 * content_performance: views, conversions, search clicks. Знаходить
 * winners (≥3 conversions) і duds (≥30 днів опубліковано, 0 trafic).
 *
 * Winners → insight "масштабувати агент-генерацію подібних сторінок".
 * Duds → insight "розглянути unpublish або переписати".
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

const AGENT_ID = "autonomous-seo-loop";

export const Route = createFileRoute("/hooks/agents/autonomous-seo-loop")({
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
          const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
          const { data: pages, error } = await supabaseAdmin
            .from("content_pages")
            .select("id, slug, title, agent, published_at, is_published, agent_generated, content_type")
            .eq("tenant_id", tenantId)
            .eq("agent_generated", true)
            .eq("is_published", true)
            .gte("published_at", since)
            .limit(1000);
          if (error) throw error;
          if (!pages || pages.length === 0) {
            await finishAgentRun(handle, 0, { reason: "no_agent_pages" });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          const pageIds = pages.map((p) => p.id);
          const { data: perfRows, error: perfErr } = await supabaseAdmin
            .from("content_performance")
            .select(
              "page_id, views, unique_visitors, conversions, search_clicks, search_impressions, measured_on",
            )
            .eq("tenant_id", tenantId)
            .in("page_id", pageIds)
            .gte("measured_on", since.slice(0, 10))
            .limit(50_000);
          if (perfErr) throw perfErr;

          // aggregate by page_id
          type Agg = { views: number; conversions: number; clicks: number; impressions: number };
          const aggByPage = new Map<string, Agg>();
          for (const r of perfRows ?? []) {
            if (!r.page_id) continue;
            const a = aggByPage.get(r.page_id) ?? {
              views: 0,
              conversions: 0,
              clicks: 0,
              impressions: 0,
            };
            a.views += r.views ?? 0;
            a.conversions += r.conversions ?? 0;
            a.clicks += r.search_clicks ?? 0;
            a.impressions += r.search_impressions ?? 0;
            aggByPage.set(r.page_id, a);
          }

          const winners: Array<{
            slug: string;
            title: string;
            agent: string | null;
            views: number;
            conversions: number;
          }> = [];
          const duds: Array<{
            slug: string;
            title: string;
            agent: string | null;
            published_at: string | null;
            views: number;
          }> = [];
          const cutoff30d = Date.now() - 30 * 86_400_000;

          for (const p of pages) {
            const agg = aggByPage.get(p.id) ?? {
              views: 0,
              conversions: 0,
              clicks: 0,
              impressions: 0,
            };
            if (agg.conversions >= 3) {
              winners.push({
                slug: p.slug,
                title: p.title,
                agent: p.agent,
                views: agg.views,
                conversions: agg.conversions,
              });
            } else if (
              agg.views < 5 &&
              p.published_at &&
              new Date(p.published_at).getTime() < cutoff30d
            ) {
              duds.push({
                slug: p.slug,
                title: p.title,
                agent: p.agent,
                published_at: p.published_at,
                views: agg.views,
              });
            }
          }

          const insights: AgentInsightInput[] = [];

          if (winners.length > 0) {
            const top = winners.sort((a, b) => b.conversions - a.conversions).slice(0, 5);
            // Group winning agents
            const agentCounts = new Map<string, number>();
            for (const w of winners) {
              if (w.agent) agentCounts.set(w.agent, (agentCounts.get(w.agent) ?? 0) + 1);
            }
            insights.push({
              tenant_id: tenantId,
              insight_type: "seo_loop_winners",
              affected_layer: "content",
              title: `${winners.length} автогенерованих сторінок дають конверсії`,
              description: `Серед ${pages.length} agent-сторінок ${winners.length} вже принесли продажі. Це підтверджує, що автоконтент працює — час масштабувати.`,
              expected_impact:
                "Подвоїти cadence content-velocity / programmatic-seo агента → лінійне зростання трафіку та продажів.",
              confidence: 0.8,
              risk_level: "low",
              metrics: {
                winners_count: winners.length,
                top_winners: top,
                producing_agents: Object.fromEntries(agentCounts),
                suggested_action: "scale_content_generation",
              },
              dedup_key: `seo_winners::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          if (duds.length >= 5) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "seo_loop_duds",
              affected_layer: "content",
              title: `${duds.length} agent-сторінок без трафіку >30 днів`,
              description: `Опубліковані, але не залучили відвідувачів — або тема порожня, або заголовки не цікаві Google.`,
              expected_impact:
                "Розглянь unpublish або переписати title/description через ШІ. Зменшує SEO-noise і покращує загальну якість домену.",
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                duds_count: duds.length,
                examples: duds.slice(0, 5),
                suggested_action: "unpublish_or_rewrite",
              },
              dedup_key: `seo_duds::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            pages_scanned: pages.length,
            winners: winners.length,
            duds: duds.length,
          });
          return jsonOk({
            run_id: handle.runId,
            pages_scanned: pages.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Autonomous SEO loop failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
