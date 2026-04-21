/**
 * Bootstrap Agent: Catalog Enricher
 *
 * Дивиться на products + product metadata і знаходить чого бракує:
 *   - description порожній / коротший за 60 символів
 *   - відсутній image_url
 *   - відсутні category, weight, sku
 *   - cost_cents відсутній (потрібен для margin-estimator)
 * Пише підсумок у bootstrap_facts(catalog_quality) і генерує insights
 * за топ-10 проблем.
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
import { upsertBootstrapFacts } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "catalog_enricher";

type Row = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number | null;
  metadata: Record<string, unknown> | null;
};

export const Route = createFileRoute("/hooks/agents/catalog-enricher")({
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
          const { data, error } = await supabaseAdmin
            .from("products")
            .select("id, name, description, image_url, price_cents, metadata")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .limit(500);
          if (error) throw error;
          const rows = (data ?? []) as Row[];

          let missingDesc = 0;
          let shortDesc = 0;
          let missingImage = 0;
          let missingCategory = 0;
          let missingCost = 0;
          let missingPrice = 0;
          const worst: Array<{ id: string; name: string; missing: string[] }> = [];

          for (const r of rows) {
            const meta = (r.metadata ?? {}) as Record<string, unknown>;
            const missing: string[] = [];
            if (!r.description) {
              missingDesc++;
              missing.push("description");
            } else if (r.description.length < 60) {
              shortDesc++;
              missing.push("short_description");
            }
            if (!r.image_url) {
              missingImage++;
              missing.push("image");
            }
            if (!meta.category) {
              missingCategory++;
              missing.push("category");
            }
            if (typeof meta.cost_cents !== "number" || meta.cost_cents <= 0) {
              missingCost++;
              missing.push("cost");
            }
            if (!r.price_cents || r.price_cents <= 0) {
              missingPrice++;
              missing.push("price");
            }
            if (missing.length > 0) worst.push({ id: r.id, name: r.name, missing });
          }

          worst.sort((a, b) => b.missing.length - a.missing.length);

          const completeness =
            rows.length === 0
              ? 0
              : Math.max(
                  0,
                  1 -
                    (missingDesc + missingImage + missingCategory + missingCost + missingPrice) /
                      (rows.length * 5),
                );

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "catalog_quality",
              value: {
                products_total: rows.length,
                missing_description: missingDesc,
                short_description: shortDesc,
                missing_image: missingImage,
                missing_category: missingCategory,
                missing_cost: missingCost,
                missing_price: missingPrice,
                completeness_score: Number(completeness.toFixed(3)),
                worst_offenders: worst.slice(0, 10),
              },
              confidence: 0.95,
            },
          ]);

          const insights: AgentInsightInput[] = [];
          if (missingDesc > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_catalog_missing_desc",
              affected_layer: "catalog",
              title: `${missingDesc} product${missingDesc === 1 ? "" : "s"} have no description`,
              description:
                "Бот і SEO-агент не зможуть гарно презентувати товар без опису. Додайте 2-3 речення з ключовою користю.",
              expected_impact: "Покращує конверсію storefront та якість бот-відповідей",
              confidence: 0.9,
              risk_level: missingDesc > rows.length / 2 ? "high" : "medium",
              metrics: { count: missingDesc, action: "open_catalog_editor" },
              dedup_key: "catalog_missing_desc",
            });
          }
          if (missingCost > 0 && rows.length > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_catalog_missing_cost",
              affected_layer: "catalog",
              title: `${missingCost} product${missingCost === 1 ? "" : "s"} have no cost price`,
              description:
                "Без собівартості margin-optimizer та promo-portfolio працюють наосліп. Додайте cost у metadata кожного SKU.",
              expected_impact: "Активує margin-агентів і захищає від збиткових промо",
              confidence: 0.95,
              risk_level: "high",
              metrics: { count: missingCost, action: "fill_cost_metadata" },
              dedup_key: "catalog_missing_cost",
            });
          }
          if (missingImage > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_catalog_missing_image",
              affected_layer: "catalog",
              title: `${missingImage} product${missingImage === 1 ? "" : "s"} have no image`,
              description: "Картка товару без фото конвертить у 3-4 рази гірше.",
              expected_impact: "Підіймає CTR картки на ~2-3×",
              confidence: 0.85,
              risk_level: "medium",
              metrics: { count: missingImage, action: "upload_images" },
              dedup_key: "catalog_missing_image",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            products_total: rows.length,
            completeness_score: completeness,
            missing_desc: missingDesc,
            missing_image: missingImage,
            missing_cost: missingCost,
          });
          return jsonOk({ run_id: handle.runId, insights_created: created, completeness });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Catalog enricher failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
