/**
 * Review Velocity — відстежує товари з найшвидшим зростанням продажів,
 * щоб запросити відгук поки клієнти "гарячі".
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

const AGENT_ID = "review-velocity";

export const Route = createFileRoute("/hooks/agents/review-velocity")({
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
          const now = Date.now();
          const last7 = new Date(now - 7 * 86_400_000).toISOString();
          const prev7 = new Date(now - 14 * 86_400_000).toISOString();

          const { data: items } = await supabaseAdmin
            .from("order_items")
            .select("product_id, product_name, quantity, orders!inner(status, created_at)")
            .eq("tenant_id", tenantId)
            .in("orders.status", ["paid", "fulfilled"])
            .gte("orders.created_at", prev7);

          const recent = new Map<string, { name: string; qty: number }>();
          const previous = new Map<string, number>();
          for (const it of items ?? []) {
            if (!it.product_id) continue;
            const ord = (it as unknown as { orders?: { created_at?: string } }).orders;
            const orderDate = ord?.created_at ?? "";
            if (orderDate >= last7) {
              const e = recent.get(it.product_id) ?? { name: it.product_name, qty: 0 };
              e.qty += it.quantity;
              recent.set(it.product_id, e);
            } else {
              previous.set(it.product_id, (previous.get(it.product_id) ?? 0) + it.quantity);
            }
          }

          const insights: AgentInsightInput[] = [];
          for (const [pid, r] of recent) {
            const prev = previous.get(pid) ?? 0;
            if (r.qty < 5) continue;
            const growth = prev > 0 ? (r.qty - prev) / prev : r.qty / 1;
            if (growth < 0.5) continue;
            insights.push({
              tenant_id: tenantId,
              insight_type: "review_request_window",
              affected_layer: "engagement",
              title: `⭐ Час просити відгуки: ${r.name} (+${(growth * 100).toFixed(0)}%)`,
              description: `Продажі за тиждень: ${r.qty} (попередній: ${prev}). Покупці ще пам'ятають враження.`,
              expected_impact: `Відгуки підвищують CR на ~10–25% для цього товару`,
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                product_id: pid,
                product_name: r.name,
                qty_last_7d: r.qty,
                qty_prev_7d: prev,
                growth_rate: growth,
                suggested_action: "send_review_request_burst",
              },
              dedup_key: `review-window::${pid}::${new Date().toISOString().slice(0, 10)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { products_recent: recent.size });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Review velocity failed", 500, { details: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  },
});
