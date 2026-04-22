/**
 * Social Proof Live — знаходить топ-продукти, які мають низький
 * "social proof" сигнал (мало переглядів за 7 днів) попри високу маржу
 * або історію продажів. Пропонує підсилити storefront показом
 * "X людей купили цей тиждень" або реальних відгуків.
 *
 * Також знаходить продукти з високими view_count але 0 покупок —
 * це "trust gap": бачать але не купують.
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

const AGENT_ID = "social-proof-live";

export const Route = createFileRoute("/hooks/agents/social-proof-live")({
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
          const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const [productsRes, eventsRes, itemsRes] = await Promise.all([
            supabaseAdmin
              .from("products")
              .select("id, name, price_cents, stock")
              .eq("tenant_id", tenantId)
              .eq("is_active", true)
              .limit(500),
            supabaseAdmin
              .from("events")
              .select("type, product_id, session_id, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", since)
              .not("product_id", "is", null)
              .limit(20_000),
            supabaseAdmin
              .from("order_items")
              .select("product_id, quantity, created_at")
              .eq("tenant_id", tenantId)
              .gte("created_at", since)
              .not("product_id", "is", null)
              .limit(20_000),
          ]);

          const products = productsRes.data ?? [];
          if (products.length === 0) {
            await finishAgentRun(handle, 0, { reason: "no_products" });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          // views per product
          const viewsByProduct = new Map<string, Set<string>>();
          for (const e of eventsRes.data ?? []) {
            if (e.type !== "product_viewed" || !e.product_id) continue;
            const set = viewsByProduct.get(e.product_id) ?? new Set<string>();
            if (e.session_id) set.add(e.session_id);
            viewsByProduct.set(e.product_id, set);
          }

          // purchases per product (units sold)
          const salesByProduct = new Map<string, number>();
          for (const it of itemsRes.data ?? []) {
            if (!it.product_id) continue;
            salesByProduct.set(
              it.product_id,
              (salesByProduct.get(it.product_id) ?? 0) + (it.quantity ?? 0),
            );
          }

          const insights: AgentInsightInput[] = [];
          const trustGapItems: Array<{
            product_id: string;
            name: string;
            views: number;
            sales: number;
          }> = [];
          const hiddenGems: Array<{
            product_id: string;
            name: string;
            views: number;
            sales: number;
          }> = [];

          for (const p of products) {
            const views = viewsByProduct.get(p.id)?.size ?? 0;
            const sales = salesByProduct.get(p.id) ?? 0;
            // Trust gap: ≥30 unique viewers, 0 sales
            if (views >= 30 && sales === 0 && p.stock > 0) {
              trustGapItems.push({ product_id: p.id, name: p.name, views, sales });
            }
            // Hidden gem: sold ≥3 in last week but viewed by <10 sessions → underexposed
            if (sales >= 3 && views < 10) {
              hiddenGems.push({ product_id: p.id, name: p.name, views, sales });
            }
          }

          if (trustGapItems.length > 0) {
            const top = trustGapItems.sort((a, b) => b.views - a.views).slice(0, 5);
            insights.push({
              tenant_id: tenantId,
              insight_type: "social_proof_trust_gap",
              affected_layer: "storefront",
              title: `${trustGapItems.length} товарів дивляться, але не купують`,
              description: `Покупці бачать сторінку, але не довіряють — типово через відсутність відгуків чи фото.`,
              expected_impact:
                "Додати реальні відгуки або 'X купили цього тижня' під price → конверсія цих SKU зазвичай +15-30%.",
              confidence: 0.7,
              risk_level: "medium",
              metrics: {
                trust_gap_count: trustGapItems.length,
                top_products: top,
                suggested_action: "add_social_proof_widget",
              },
              dedup_key: `trust_gap::${trustGapItems.length}`,
            });
          }

          if (hiddenGems.length > 0) {
            const top = hiddenGems.sort((a, b) => b.sales - a.sales).slice(0, 5);
            insights.push({
              tenant_id: tenantId,
              insight_type: "social_proof_hidden_gem",
              affected_layer: "storefront",
              title: `${hiddenGems.length} приховані бестселери`,
              description: `Ці товари купують навіть з мізерним трафіком — якщо підняти їх у каталозі чи додати у featured, продажі мають вирости лінійно з показами.`,
              expected_impact:
                "Підняти у featured-секції або згенерувати SEO-сторінку → +50-200% продажів цих SKU.",
              confidence: 0.75,
              risk_level: "low",
              metrics: {
                hidden_gem_count: hiddenGems.length,
                top_products: top,
                suggested_action: "promote_hidden_gems",
              },
              dedup_key: `hidden_gem::${hiddenGems.length}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            products_scanned: products.length,
            trust_gaps: trustGapItems.length,
            hidden_gems: hiddenGems.length,
          });
          return jsonOk({
            run_id: handle.runId,
            products_scanned: products.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Social proof live failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
