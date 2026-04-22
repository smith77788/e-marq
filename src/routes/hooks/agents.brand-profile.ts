/**
 * Bootstrap Agent: Brand Profile Discoverer
 *
 * Розвідник: збирає базовий профіль бренду з вже наявних даних та (опційно)
 * сайту самого бренду. Заповнює bootstrap_facts(brand_profile) — на цей факт
 * далі спираються broadcast-composer, seo-rewriter, owner-playbook та інші
 * 65+ робочих агентів (тон, місія, ціновий сегмент).
 *
 * Джерела:
 *   - tenants.name + slug
 *   - tenant_configs.brand_name / seo
 *   - storefront URL → fetch + LLM extraction (тільки сайт самого бренду)
 *   - products: середня ціна, кількість категорій → ціновий сегмент
 *   - content_pages: тон з blog описів
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
import { upsertBootstrapFacts } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "brand_profile_discoverer";

type ProductRow = { name: string; price_cents: number; metadata: Record<string, unknown> | null };

export const Route = createFileRoute("/hooks/agents/brand-profile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
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
          const [tenantRes, cfgRes, productsRes, contentRes] = await Promise.all([
            supabaseAdmin
              .from("tenants")
              .select("name, slug, created_at")
              .eq("id", tenantId)
              .maybeSingle(),
            supabaseAdmin
              .from("tenant_configs")
              .select("brand_name, seo, ui, features, bot")
              .eq("tenant_id", tenantId)
              .maybeSingle(),
            supabaseAdmin
              .from("products")
              .select("name, price_cents, metadata")
              .eq("tenant_id", tenantId)
              .eq("is_active", true)
              .limit(50),
            supabaseAdmin
              .from("content_pages")
              .select("title, body_md, content_type")
              .eq("tenant_id", tenantId)
              .eq("is_published", true)
              .limit(20),
          ]);

          const tenant = tenantRes.data;
          const cfg = cfgRes.data;
          const products = (productsRes.data ?? []) as ProductRow[];
          const content = contentRes.data ?? [];

          const brandName = cfg?.brand_name ?? tenant?.name ?? "Unknown brand";
          const seoMeta = (cfg?.seo ?? {}) as Record<string, unknown>;
          const description =
            (typeof seoMeta.description === "string" && seoMeta.description) ||
            (typeof seoMeta.tagline === "string" && seoMeta.tagline) ||
            null;
          const keywords = Array.isArray(seoMeta.keywords) ? (seoMeta.keywords as string[]) : [];

          // Categories from product metadata
          const categories = new Set<string>();
          let totalPrice = 0;
          let priced = 0;
          for (const p of products) {
            const meta = (p.metadata ?? {}) as Record<string, unknown>;
            const cat = typeof meta.category === "string" ? meta.category : null;
            if (cat) categories.add(cat);
            if (typeof p.price_cents === "number" && p.price_cents > 0) {
              totalPrice += p.price_cents;
              priced++;
            }
          }
          const avgPriceCents = priced > 0 ? Math.round(totalPrice / priced) : 0;

          // Цінова позиція (грубо для UAH-середовища; працює і для USD)
          let priceTier: "budget" | "mid" | "premium" | "luxury" = "mid";
          if (avgPriceCents < 5_000) priceTier = "budget";
          else if (avgPriceCents < 30_000) priceTier = "mid";
          else if (avgPriceCents < 150_000) priceTier = "premium";
          else priceTier = "luxury";

          // Voice/tone з content_pages: рахуємо середню довжину речень як проксі
          const totalWords = content.reduce((s, c) => s + (c.body_md?.split(/\s+/).length ?? 0), 0);
          const avgWordsPerPost = content.length > 0 ? Math.round(totalWords / content.length) : 0;
          const tone =
            avgWordsPerPost > 400
              ? "editorial"
              : avgWordsPerPost > 150
                ? "conversational"
                : "minimal";

          const profile = {
            brand_name: brandName,
            slug: tenant?.slug,
            description,
            keywords,
            categories: Array.from(categories),
            avg_price_cents: avgPriceCents,
            price_tier: priceTier,
            tone,
            content_pieces: content.length,
            products_count: products.length,
            discovered_at: new Date().toISOString(),
          };

          const confidence =
            (description ? 0.25 : 0) +
            (categories.size > 0 ? 0.25 : 0) +
            (priced > 0 ? 0.25 : 0) +
            (content.length > 0 ? 0.25 : 0);

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "brand_profile",
              value: profile,
              confidence: Math.max(0.3, confidence),
              evidence: { products: products.length, content_pages: content.length },
            },
          ]);

          // Якщо профіль слабкий — створюємо insight для власника
          const insights: AgentInsightInput[] = [];
          if (!description) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_missing_brand_desc",
              affected_layer: "brand",
              title: "Add a brand tagline & description",
              description:
                "Without a one-line tagline + 2-3 sentence description, broadcast/SEO agents fall back to generic templates. Open Brand Settings → SEO and add it.",
              expected_impact: "Boosts open-rate of AI broadcasts by ~15%",
              confidence: 0.85,
              risk_level: "medium",
              metrics: { action: "open_brand_seo", missing: "description" },
              dedup_key: "missing_brand_desc",
            });
          }
          if (categories.size === 0 && products.length > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_missing_categories",
              affected_layer: "catalog",
              title: "Tag products with categories",
              description: `${products.length} products have no category tag. Bundle/cross-sell agents need categories to suggest combinations.`,
              expected_impact: "Unlocks bundle-recommender & product-affinity",
              confidence: 0.9,
              risk_level: "medium",
              metrics: { products: products.length, action: "tag_categories" },
              dedup_key: "missing_categories",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            facts_written: 1,
            confidence,
            price_tier: priceTier,
            tone,
          });
          return jsonOk({ run_id: handle.runId, insights_created: created, profile });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Brand profile agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
