/**
 * Content Velocity (ported from MFD `acos-content-velocity`).
 *
 * Аналізує темп публікації (нові content_pages за 30д) та порівнює з продуктивністю.
 * Якщо темп <1 пост/тиждень або топ-сторінки старіші 90 днів — пропонує бустити.
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

export const Route = createFileRoute("/hooks/agents/content-velocity")({
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

        const handle = await startAgentRun("content-velocity", tenantId, ctx);
        try {
          const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
          const since90 = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

          const { data: pages } = await supabaseAdmin
            .from("content_pages")
            .select("id, slug, title, published_at, content_type")
            .eq("tenant_id", tenantId)
            .eq("is_published", true)
            .order("published_at", { ascending: false });

          const total = pages?.length ?? 0;
          const last30 = (pages ?? []).filter(
            (p) => p.published_at && p.published_at >= since30,
          ).length;
          const last90 = (pages ?? []).filter(
            (p) => p.published_at && p.published_at >= since90,
          ).length;

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];

          // Slow velocity: <1 published page per week (i.e., <4 in 30d) when total > 0
          if (total > 0 && last30 < 4) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "content_velocity_low",
              affected_layer: "seo",
              title: `Темп контенту низький: ${last30} нових за 30 днів`,
              description: `За 90 днів опубліковано ${last90} сторінок. Для стабільного органічного росту потрібно ~4 пости/місяць.`,
              expected_impact:
                "Відновлення темпу до 4 публ/міс зазвичай дає +30-50% органічного трафіку за 90 днів.",
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                published_30d: last30,
                published_90d: last90,
                total_published: total,
                target_per_month: 4,
              },
              dedup_key: `content-velocity::low::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          // Stale: top by perf is older than 90d
          const { data: perf } = await supabaseAdmin
            .from("content_performance")
            .select("page_id, views")
            .eq("tenant_id", tenantId)
            .gte("measured_on", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));

          const viewsByPage = new Map<string, number>();
          for (const p of perf ?? []) {
            if (!p.page_id) continue;
            viewsByPage.set(p.page_id, (viewsByPage.get(p.page_id) ?? 0) + (p.views ?? 0));
          }
          const ranked = (pages ?? [])
            .map((p) => ({ ...p, views: viewsByPage.get(p.id) ?? 0 }))
            .filter((p) => p.views > 0)
            .sort((a, b) => b.views - a.views)
            .slice(0, 5);

          for (const p of ranked) {
            if (!p.published_at) continue;
            const ageDays = Math.floor(
              (Date.now() - new Date(p.published_at).getTime()) / (24 * 3600 * 1000),
            );
            if (ageDays < 90) continue;
            insights.push({
              tenant_id: tenantId!,
              insight_type: "content_stale_topperformer",
              affected_layer: "seo",
              title: `"${p.title}" — топ-сторінка вже ${ageDays} днів без оновлення`,
              description: `${p.views} переглядів за 30д. Свіжий refresh (новий рік, дані, скріни) часто дає +20-40% росту.`,
              expected_impact: "Оновлений топ-контент дає вибірковий ріст без нових постів.",
              confidence: 0.65,
              risk_level: "low",
              metrics: {
                page_id: p.id,
                slug: p.slug,
                age_days: ageDays,
                views_30d: p.views,
              },
              dedup_key: `content-stale::${p.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            published_30d: last30,
            stale_top: insights.filter((i) => i.insight_type === "content_stale_topperformer").length,
          });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Content velocity failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
