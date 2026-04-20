/**
 * Programmatic SEO (ported from MFD `acos-programmatic-seo`).
 *
 * На основі search_queries (zero/high-intent) та активних products пропонує генерувати
 * landing-сторінки за шаблоном "[product] for [use-case/audience]" / "best [category] under $X".
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

export const Route = createFileRoute("/hooks/agents/programmatic-seo")({
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

        const handle = await startAgentRun("programmatic-seo", tenantId, ctx);
        try {
          const [{ data: products }, { data: pages }, { data: queries }] = await Promise.all([
            supabaseAdmin
              .from("products")
              .select("id, name")
              .eq("tenant_id", tenantId)
              .eq("is_active", true)
              .limit(50),
            supabaseAdmin
              .from("content_pages")
              .select("slug")
              .eq("tenant_id", tenantId),
            supabaseAdmin
              .from("search_queries")
              .select("query")
              .eq("tenant_id", tenantId)
              .gte(
                "occurred_at",
                new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
              ),
          ]);

          if (!products?.length) {
            await finishAgentRun(handle, 0, { reason: "no_products" });
            return jsonOk({ insights_created: 0 });
          }

          const existingSlugs = new Set((pages ?? []).map((p) => p.slug.toLowerCase()));

          // Extract candidate modifiers from search queries
          const modifiers = new Set<string>();
          for (const r of queries ?? []) {
            const q = r.query.trim().toLowerCase();
            // Heuristic: "best X for Y", "X under $N", "X for Z"
            const m1 = q.match(/\bfor\s+([a-z][a-z\s]{2,30})/);
            if (m1) modifiers.add(`for-${slugify(m1[1])}`);
            const m2 = q.match(/\bunder\s+\$?(\d+)/);
            if (m2) modifiers.add(`under-${m2[1]}`);
            const m3 = q.match(/\b(best|cheap|premium|organic|vegan|gluten[-\s]?free)\b/);
            if (m3) modifiers.add(slugify(m3[1]));
          }

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];
          const proposed: { slug: string; title: string }[] = [];

          // Strategy A: per-product modifier landings (limit 5)
          for (const p of products.slice(0, 10)) {
            for (const mod of [...modifiers].slice(0, 3)) {
              const slug = `${slugify(p.name)}-${mod}`;
              if (existingSlugs.has(slug)) continue;
              proposed.push({
                slug,
                title: `${p.name} ${mod.replace(/-/g, " ")}`,
              });
              if (proposed.length >= 5) break;
            }
            if (proposed.length >= 5) break;
          }

          if (proposed.length >= 3) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "programmatic_seo_opportunity",
              affected_layer: "seo",
              title: `${proposed.length} programmatic landing-сторінок готові до генерації`,
              description: `Знайдені gap між пошуковими запитами і існуючими сторінками. Шаблонна генерація закриє довгий хвіст.`,
              expected_impact:
                "Pack з 5 landing-сторінок зазвичай тягне 200-800 додаткових органічних візитів/міс через 90 днів.",
              confidence: 0.65,
              risk_level: "low",
              metrics: {
                proposed_pages: proposed,
                modifiers_found: modifiers.size,
                products_used: Math.min(products.length, 10),
              },
              dedup_key: `programmatic-seo::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            proposed: proposed.length,
            modifiers: modifiers.size,
          });
          return jsonOk({ insights_created: created, proposed: proposed.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Programmatic SEO failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
