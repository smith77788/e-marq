/**
 * Product Affinity (ported from MFD `acos-product-affinity`).
 *
 * Розширює bundle-recommender: окрім bundle-pairs, обчислює "next-best-product"
 * для кожного top-SKU — що людина купує наступного разу після цього товару.
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

export const Route = createFileRoute("/hooks/agents/product-affinity")({
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

        const handle = await startAgentRun("product-affinity", tenantId, ctx);
        try {
          const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

          // Pull paid orders per customer, ordered by paid_at
          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("id, customer_user_id, customer_email, paid_at")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("paid_at", since)
            .order("paid_at", { ascending: true });

          if (!orders?.length) {
            await finishAgentRun(handle, 0, { reason: "no_orders" });
            return jsonOk({ insights_created: 0 });
          }

          const orderIds = orders.map((o) => o.id);
          const { data: items } = await supabaseAdmin
            .from("order_items")
            .select("order_id, product_id, product_name")
            .in("order_id", orderIds)
            .not("product_id", "is", null);

          const itemsByOrder = new Map<string, { id: string; name: string }[]>();
          for (const it of items ?? []) {
            if (!it.product_id) continue;
            const list = itemsByOrder.get(it.order_id) ?? [];
            list.push({ id: it.product_id, name: it.product_name });
            itemsByOrder.set(it.order_id, list);
          }

          // Group orders by customer key
          const byCustomer = new Map<
            string,
            { paidAt: string; productIds: string[]; names: Map<string, string> }[]
          >();
          for (const o of orders) {
            const key = o.customer_user_id ?? o.customer_email?.toLowerCase();
            if (!key || !o.paid_at) continue;
            const list = byCustomer.get(key) ?? [];
            const its = itemsByOrder.get(o.id) ?? [];
            const nm = new Map<string, string>();
            for (const i of its) nm.set(i.id, i.name);
            list.push({
              paidAt: o.paid_at,
              productIds: [...new Set(its.map((i) => i.id))],
              names: nm,
            });
            byCustomer.set(key, list);
          }

          // Build sequential transitions: for each customer, look at consecutive orders
          type Trans = {
            from: string;
            to: string;
            fromName: string;
            toName: string;
            count: number;
          };
          const transitions = new Map<string, Trans>();
          for (const [, oList] of byCustomer) {
            if (oList.length < 2) continue;
            for (let i = 1; i < oList.length; i++) {
              const prev = oList[i - 1];
              const cur = oList[i];
              for (const a of prev.productIds) {
                for (const b of cur.productIds) {
                  if (a === b) continue;
                  const key = `${a}->${b}`;
                  const t = transitions.get(key) ?? {
                    from: a,
                    to: b,
                    fromName: prev.names.get(a) ?? "",
                    toName: cur.names.get(b) ?? "",
                    count: 0,
                  };
                  t.count += 1;
                  transitions.set(key, t);
                }
              }
            }
          }

          // For each "from" product, pick best "to" by count (>=3)
          const bestNext = new Map<string, Trans>();
          for (const [, t] of transitions) {
            if (t.count < 3) continue;
            const cur = bestNext.get(t.from);
            if (!cur || cur.count < t.count) bestNext.set(t.from, t);
          }

          const top = [...bestNext.values()].sort((a, b) => b.count - a.count).slice(0, 5);

          const insights: Parameters<typeof insertInsightsDedup>[0] = top.map((t) => ({
            tenant_id: tenantId!,
            insight_type: "next_best_product",
            affected_layer: "merchandising",
            title: `Після "${t.fromName}" зазвичай беруть "${t.toName}"`,
            description: `${t.count} клієнтів зробили цей перехід за 90 днів — стабільний паттерн.`,
            expected_impact: `Auto-recommend "${t.toName}" у пост-purchase / reorder для покупців "${t.fromName}".`,
            confidence: Math.min(0.9, 0.5 + t.count * 0.05),
            risk_level: "low",
            metrics: {
              from_product_id: t.from,
              to_product_id: t.to,
              from_name: t.fromName,
              to_name: t.toName,
              transition_count: t.count,
            },
            dedup_key: `next-best::${t.from}::${t.to}`,
          }));

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            transitions: transitions.size,
            best_next: bestNext.size,
            customers_with_repeat: [...byCustomer.values()].filter((l) => l.length >= 2).length,
          });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Product affinity failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
