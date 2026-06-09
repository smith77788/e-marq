/**
 * UGC Harvester (ported from MFD `acos-ugc-harvester`).
 *
 * Шукає клієнтів з 2+ оплаченими замовленнями за 60д, від яких ще немає UGC,
 * і пропонує запросити їх лишити відгук.
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

export const Route = createFileRoute("/hooks/agents/ugc-harvester")({
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

        const handle = await startAgentRun("ugc-harvester", tenantId, ctx);
        try {
          // Existing UGC authors
          const { data: ugc, error: ugcErr } = await supabaseAdmin
            .from("ugc_items")
            .select("customer_id, product_id, rating")
            .eq("tenant_id", tenantId)
            .limit(5000);
          if (ugcErr) throw ugcErr;
          const ugcByCustomer = new Set<string>();
          const ugcRatings: number[] = [];
          for (const u of ugc ?? []) {
            if (u.customer_id) ugcByCustomer.add(u.customer_id);
            if (typeof u.rating === "number") ugcRatings.push(u.rating);
          }

          // Eligible customers: 2+ orders, last order in last 60 days
          const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select("id, name, email, total_orders, last_order_at, consent_marketing")
            .eq("tenant_id", tenantId)
            .gte("total_orders", 2)
            .gte("last_order_at", since)
            .order("total_orders", { ascending: false })
            .limit(200);

          const eligible = (customers ?? []).filter(
            (c) => !ugcByCustomer.has(c.id) && c.consent_marketing !== false,
          );

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];
          if (eligible.length >= 5) {
            const sample = eligible.slice(0, 50);
            insights.push({
              tenant_id: tenantId!,
              insight_type: "ugc_harvest_opportunity",
              affected_layer: "social_proof",
              title: `${eligible.length} лояльних клієнтів — ще не лишили відгук`,
              description: `У них 2+ замовлення за 60 днів. Це найкращі кандидати на відгуки/фото.`,
              expected_impact:
                "Кампанія UGC-запитів зазвичай дає 15-25% conversion — це 5-10+ нових social proof.",
              confidence: 0.8,
              risk_level: "low",
              metrics: {
                eligible_count: eligible.length,
                sample_customer_ids: sample.map((c) => c.id),
                expected_responses: Math.round(eligible.length * 0.2),
              },
              dedup_key: `ugc-harvest::weekly::${new Date().toISOString().slice(0, 10)}`,
            });
          }

          // Low UGC volume
          const totalUgc = ugc?.length ?? 0;
          if (totalUgc < 5 && (customers?.length ?? 0) >= 10) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "ugc_low_volume",
              affected_layer: "social_proof",
              title: `Всього ${totalUgc} відгуків — мало для довіри`,
              description: `Бренди з 20+ відгуків мають у ~1.4× вищу конверсію на storefront.`,
              expected_impact:
                "Запусти регулярний пост-purchase запит — ціль 20+ відгуків за квартал.",
              confidence: 0.75,
              risk_level: "low",
              metrics: {
                ugc_count: totalUgc,
                avg_rating:
                  ugcRatings.length > 0
                    ? ugcRatings.reduce((s, r) => s + r, 0) / ugcRatings.length
                    : null,
              },
              dedup_key: `ugc-low::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            eligible: eligible.length,
            existing_ugc: totalUgc,
          });
          return jsonOk({ insights_created: created, eligible: eligible.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("UGC harvester failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
