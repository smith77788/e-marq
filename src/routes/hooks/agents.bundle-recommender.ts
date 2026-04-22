/**
 * Bundle Recommender (ported from MFD `acos-bundle-suggest`).
 *
 * Знаходить пари товарів які часто купують разом (basket-mining з 60д order_items),
 * рахує product_affinity.lift_score і пропонує bundle на топ-3 пари.
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

export const Route = createFileRoute("/hooks/agents/bundle-recommender")({
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

        const handle = await startAgentRun("bundle-recommender", tenantId, ctx);
        try {
          const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();

          // Load order_items grouped by order
          const { data: items } = await supabaseAdmin
            .from("order_items")
            .select("order_id, product_id, product_name, unit_price_cents")
            .eq("tenant_id", tenantId)
            .gte("created_at", since)
            .not("product_id", "is", null);

          if (!items?.length) {
            await finishAgentRun(handle, 0, { reason: "no_items" });
            return jsonOk({ insights_created: 0 });
          }

          // Group items per order
          const orderItems = new Map<string, { id: string; name: string; price: number }[]>();
          for (const it of items) {
            if (!it.product_id) continue;
            const list = orderItems.get(it.order_id) ?? [];
            list.push({ id: it.product_id, name: it.product_name, price: it.unit_price_cents });
            orderItems.set(it.order_id, list);
          }

          // Single-product counts and pair counts
          const single = new Map<string, number>();
          const pair = new Map<
            string,
            {
              a: string;
              b: string;
              nameA: string;
              nameB: string;
              priceA: number;
              priceB: number;
              count: number;
            }
          >();
          let totalOrders = 0;
          for (const [, list] of orderItems) {
            totalOrders++;
            const seen = new Set<string>();
            for (const i of list) {
              if (seen.has(i.id)) continue;
              seen.add(i.id);
              single.set(i.id, (single.get(i.id) ?? 0) + 1);
            }
            const ids = [...seen];
            for (let i = 0; i < ids.length; i++) {
              for (let j = i + 1; j < ids.length; j++) {
                const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
                const key = `${a}|${b}`;
                const ia = list.find((x) => x.id === a)!;
                const ib = list.find((x) => x.id === b)!;
                const existing = pair.get(key) ?? {
                  a,
                  b,
                  nameA: ia.name,
                  nameB: ib.name,
                  priceA: ia.price,
                  priceB: ib.price,
                  count: 0,
                };
                existing.count += 1;
                pair.set(key, existing);
              }
            }
          }

          // Compute lift = P(A,B) / (P(A)*P(B)). Need lift>=1.5 and count>=3
          const candidates = [];
          for (const [, p] of pair) {
            const pA = (single.get(p.a) ?? 0) / totalOrders;
            const pB = (single.get(p.b) ?? 0) / totalOrders;
            const pAB = p.count / totalOrders;
            if (pA === 0 || pB === 0) continue;
            const lift = pAB / (pA * pB);
            if (lift < 1.5 || p.count < 3) continue;
            candidates.push({ ...p, lift, pAB });
          }
          candidates.sort((x, y) => y.lift * y.count - x.lift * x.count);

          // Upsert product_affinity for top-20
          for (const c of candidates.slice(0, 20)) {
            await supabaseAdmin.from("product_affinity").upsert(
              {
                tenant_id: tenantId,
                product_a_id: c.a,
                product_b_id: c.b,
                co_purchase_count: c.count,
                lift_score: c.lift,
                computed_at: new Date().toISOString(),
              },
              { onConflict: "tenant_id,product_a_id,product_b_id", ignoreDuplicates: false },
            );
          }

          // Insights for top-3 pairs that have no active bundle
          const top = candidates.slice(0, 3);
          const productIdsAll = top.flatMap((t) => [t.a, t.b]);
          const { data: existingBundles } = productIdsAll.length
            ? await supabaseAdmin
                .from("product_bundles")
                .select("product_ids")
                .eq("tenant_id", tenantId)
                .eq("is_active", true)
            : { data: [] };
          const bundledPairs = new Set<string>();
          for (const b of existingBundles ?? []) {
            const ids = (b.product_ids as string[]).slice().sort();
            for (let i = 0; i < ids.length; i++) {
              for (let j = i + 1; j < ids.length; j++) {
                bundledPairs.add(`${ids[i]}|${ids[j]}`);
              }
            }
          }

          const insights = top
            .filter((t) => !bundledPairs.has(`${t.a}|${t.b}`))
            .map((t) => {
              const individual = t.priceA + t.priceB;
              const suggestedBundle = Math.round(individual * 0.9); // 10% off
              return {
                tenant_id: tenantId,
                insight_type: "bundle_opportunity",
                affected_layer: "merchandising",
                title: `Бандл: ${t.nameA} + ${t.nameB}`,
                description: `Куплені разом ${t.count} раз${t.count === 1 ? "" : "и"} (lift ${t.lift.toFixed(1)}× від випадковості).`,
                expected_impact: `Bundle за ${formatCents(suggestedBundle)} (-10%) може дати ~${formatCents(suggestedBundle * 5)} додатково на місяць.`,
                confidence: Math.min(0.95, 0.5 + t.lift / 10),
                risk_level: "low" as const,
                metrics: {
                  product_a_id: t.a,
                  product_b_id: t.b,
                  product_a_name: t.nameA,
                  product_b_name: t.nameB,
                  co_purchase_count: t.count,
                  lift_score: t.lift,
                  individual_price_cents: individual,
                  suggested_bundle_price_cents: suggestedBundle,
                  discount_pct: 10,
                },
                dedup_key: `bundle::${t.a}::${t.b}`,
              };
            });

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            candidates: candidates.length,
            top_pairs: top.length,
            total_orders: totalOrders,
          });
          return jsonOk({ insights_created: created, candidates: candidates.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Bundle recommender failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `${(c / 100).toFixed(c >= 1000 ? 0 : 2)} ₴`;
}
