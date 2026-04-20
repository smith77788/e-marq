/**
 * Browse Abandonment — знаходить юзерів, які 3+ разів дивились картку
 * товару за останні 7 днів, але НЕ додали в кошик і НЕ купили.
 *
 * Для кожної такої пари (customer × product) генерує insight, на основі
 * якого engine.dispatch може надіслати nudge з знижкою / соцпруфом.
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

const AGENT_ID = "browse-abandonment";

type EvRow = { user_id: string | null; product_id: string | null; type: string };

export const Route = createFileRoute("/hooks/agents/browse-abandonment")({
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
          const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("events")
            .select("user_id, product_id, type")
            .eq("tenant_id", tenantId)
            .in("type", ["product_viewed", "add_to_cart", "purchase_completed"])
            .gte("created_at", since)
            .not("user_id", "is", null)
            .not("product_id", "is", null)
            .limit(50_000);
          if (error) throw error;
          const events = (data ?? []) as EvRow[];
          if (events.length === 0) {
            await finishAgentRun(handle, 0, { events: 0 });
            return jsonOk({ run_id: handle.runId, events: 0, insights_created: 0 });
          }

          // Build (user × product) → { views, addedToCart, purchased }
          type Pair = { views: number; cart: boolean; purchased: boolean };
          const pairs = new Map<string, Pair>();
          for (const e of events) {
            if (!e.user_id || !e.product_id) continue;
            const k = `${e.user_id}::${e.product_id}`;
            const p = pairs.get(k) ?? { views: 0, cart: false, purchased: false };
            if (e.type === "product_viewed") p.views++;
            else if (e.type === "add_to_cart") p.cart = true;
            else if (e.type === "purchase_completed") p.purchased = true;
            pairs.set(k, p);
          }

          const candidates: Array<{ userId: string; productId: string; views: number }> = [];
          for (const [k, p] of pairs) {
            if (p.views < 3 || p.cart || p.purchased) continue;
            const [userId, productId] = k.split("::");
            candidates.push({ userId, productId, views: p.views });
          }
          if (candidates.length === 0) {
            await finishAgentRun(handle, 0, { candidates: 0 });
            return jsonOk({ run_id: handle.runId, candidates: 0, insights_created: 0 });
          }

          // Resolve user → customer + product info
          const userIds = Array.from(new Set(candidates.map((c) => c.userId)));
          const productIds = Array.from(new Set(candidates.map((c) => c.productId)));
          const [{ data: customers }, { data: products }] = await Promise.all([
            supabaseAdmin
              .from("customers")
              .select("id, user_id, email, name")
              .eq("tenant_id", tenantId)
              .in("user_id", userIds),
            supabaseAdmin
              .from("products")
              .select("id, name, price_cents")
              .eq("tenant_id", tenantId)
              .in("id", productIds),
          ]);
          const userToCust = new Map((customers ?? []).map((c) => [c.user_id, c]));
          const prodMap = new Map((products ?? []).map((p) => [p.id, p]));

          const insights: AgentInsightInput[] = [];
          for (const c of candidates) {
            const cust = userToCust.get(c.userId);
            const prod = prodMap.get(c.productId);
            if (!cust || !prod) continue;
            insights.push({
              tenant_id: tenantId,
              insight_type: "browse_abandoned",
              affected_layer: "conversion",
              title: `${cust.name || cust.email}: дивився "${prod.name}" ${c.views}× але не купив`,
              description: `Клієнт переглядав картку ${c.views} разів за тиждень — є чіткий інтерес, але щось зупиняє від покупки. Nudge з 10% або сертифікатом якості може закрити.`,
              expected_impact: `Browse-nudge конвертить ~5-8%. Очікуваний return: ${formatCents(Math.round(prod.price_cents * 0.06))}.`,
              confidence: 0.65,
              risk_level: "low",
              metrics: {
                customer_id: cust.id,
                customer_email: cust.email,
                customer_name: cust.name,
                product_id: prod.id,
                product_name: prod.name,
                product_price_cents: prod.price_cents,
                view_count: c.views,
                suggested_action: "send_browse_nudge",
              },
              dedup_key: `browse_abandon::${cust.id}::${prod.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            candidates: candidates.length,
            actionable: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            candidates: candidates.length,
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
  return `$${(c / 100).toFixed(c >= 1000 ? 0 : 2)}`;
}
