/**
 * Second-Order Nurture — критичний агент для retention.
 * Знаходить клієнтів, які зробили РІВНО 1 замовлення 14-45 днів тому
 * і ще не повернулись. Це "прірва" між 1-м і 2-м замовленням, де відвалюється
 * найбільше людей.
 *
 * Генерує insight для кожного — engine.dispatch потім надсилає
 * персональну рекомендацію (cross-sell на основі першої покупки).
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

const AGENT_ID = "second-order-nurture";

type CustRow = {
  id: string;
  email: string | null;
  name: string | null;
  total_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  first_order_at: string | null;
};

export const Route = createFileRoute("/hooks/agents/second-order-nurture")({
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
          const now = Date.now();
          const min = new Date(now - 45 * 86_400_000).toISOString();
          const max = new Date(now - 14 * 86_400_000).toISOString();

          const { data, error } = await supabaseAdmin
            .from("customers")
            .select(
              "id, email, name, total_orders, total_spent_cents, last_order_at, first_order_at",
            )
            .eq("tenant_id", tenantId)
            .eq("total_orders", 1)
            .gte("first_order_at", min)
            .lte("first_order_at", max)
            .limit(2_000);
          if (error) throw error;
          const targets = (data ?? []) as CustRow[];
          if (targets.length === 0) {
            await finishAgentRun(handle, 0, { targets: 0 });
            return jsonOk({ run_id: handle.runId, targets: 0, insights_created: 0 });
          }

          // Get last bought product per customer to power cross-sell suggestion
          const custIds = targets.map((c) => c.id);
          // Need to fetch via orders + order_items
          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, customer_user_id, total_cents, paid_at")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .in(
              "customer_email",
              targets.map((t) => t.email).filter((e): e is string => !!e),
            )
            .limit(2_000);
          const orderToCust = new Map<string, CustRow>();
          for (const o of orders ?? []) {
            const c = targets.find(
              (t) =>
                t.email &&
                o.customer_email &&
                t.email.toLowerCase() === o.customer_email.toLowerCase(),
            );
            if (c) orderToCust.set(o.id, c);
          }
          const orderIds = Array.from(orderToCust.keys());
          const { data: items } = orderIds.length
            ? await supabaseAdmin
                .from("order_items")
                .select("order_id, product_id, product_name")
                .in("order_id", orderIds)
            : { data: [] };

          // Map customer → first-order product info
          const custProduct = new Map<string, { id: string | null; name: string }>();
          for (const it of items ?? []) {
            const c = orderToCust.get(it.order_id);
            if (!c) continue;
            if (!custProduct.has(c.id)) {
              custProduct.set(c.id, { id: it.product_id, name: it.product_name });
            }
          }

          const insights: AgentInsightInput[] = [];
          for (const c of targets) {
            if (!c.first_order_at) continue;
            const daysSince = Math.floor((now - new Date(c.first_order_at).getTime()) / 86_400_000);
            const firstProd = custProduct.get(c.id);
            const expectedReturn = Math.round(c.total_spent_cents * 0.18); // 18% reactivation conversion @ avg basket
            insights.push({
              tenant_id: tenantId,
              insight_type: "second_order_gap",
              affected_layer: "crm",
              title: `${c.name || c.email}: 1 покупка ${daysSince} днів тому, ще не повернувся`,
              description: `Купив "${firstProd?.name ?? "товар"}" і зник. 60-70% таких клієнтів ніколи не зроблять 2-ге замовлення без нагадування. Ідеальний момент — 14-45 днів після першого, поки бренд ще в пам'яті.`,
              expected_impact: `Персональний follow-up з cross-sell конвертить ~15-20%. Потенційно ${formatCents(expectedReturn)} return.`,
              confidence: 0.7,
              risk_level: "medium",
              metrics: {
                customer_id: c.id,
                customer_email: c.email,
                customer_name: c.name,
                days_since_first_order: daysSince,
                first_order_total_cents: c.total_spent_cents,
                first_order_product_id: firstProd?.id ?? null,
                first_order_product_name: firstProd?.name ?? null,
                expected_return_cents: expectedReturn,
                suggested_action: "send_second_order_nudge",
              },
              dedup_key: `second_order::${c.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            targets: targets.length,
            with_product: custProduct.size,
          });
          return jsonOk({
            run_id: handle.runId,
            targets: targets.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `${(c / 100).toFixed(c >= 1000 ? 0 : 2)} ₴`;
}
