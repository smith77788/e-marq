/**
 * ACOS Agent: AOV Leak Detector
 * Scans funnel events for last 14 days. For sessions that hit add_to_cart but
 * never reached purchase_completed within the same day, group by product and
 * estimate recoverable revenue.
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

const AGENT_ID = "aov_leak_detector";
const WINDOW_DAYS = 14;

type EventRow = {
  type: string;
  session_id: string | null;
  product_id: string | null;
  created_at: string;
};

export const Route = createFileRoute("/hooks/agents/aov-leak")({
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

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

          const { data: events, error } = await supabaseAdmin
            .from("events")
            .select("type, session_id, product_id, created_at")
            .eq("tenant_id", tenantId)
            .in("type", ["add_to_cart", "checkout_started", "purchase_completed"])
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .limit(20000);
          if (error) throw error;

          // Sessions that purchased
          const purchasedSessions = new Set<string>();
          for (const e of (events ?? []) as EventRow[]) {
            if (e.type === "purchase_completed" && e.session_id)
              purchasedSessions.add(e.session_id);
          }

          // Add-to-carts that never converted, group by product
          const abandoned: Record<
            string,
            { sessions: Set<string>; carts: number; checkouts: number }
          > = {};
          for (const e of (events ?? []) as EventRow[]) {
            if (e.type === "add_to_cart" && e.product_id) {
              if (!e.session_id || !purchasedSessions.has(e.session_id)) {
                const k = e.product_id;
                if (!abandoned[k]) abandoned[k] = { sessions: new Set(), carts: 0, checkouts: 0 };
                abandoned[k].carts++;
                if (e.session_id) abandoned[k].sessions.add(e.session_id);
              }
            }
            if (e.type === "checkout_started" && e.product_id) {
              if (!e.session_id || !purchasedSessions.has(e.session_id)) {
                const k = e.product_id;
                if (!abandoned[k]) abandoned[k] = { sessions: new Set(), carts: 0, checkouts: 0 };
                abandoned[k].checkouts++;
              }
            }
          }

          const productIds = Object.keys(abandoned);
          if (productIds.length === 0) {
            await finishAgentRun(handle, 0, {
              events_scanned: events?.length ?? 0,
              leaky_products: 0,
            });
            return jsonOk({
              run_id: handle.runId,
              events_scanned: events?.length ?? 0,
              leaky_products: 0,
              insights_created: 0,
            });
          }

          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, sku, price_cents, stock")
            .eq("tenant_id", tenantId)
            .in("id", productIds);
          const byId = new Map<
            string,
            { name: string; sku: string | null; price_cents: number; stock: number }
          >();
          for (const p of products ?? []) {
            byId.set(p.id, {
              name: p.name,
              sku: p.sku,
              price_cents: p.price_cents,
              stock: p.stock,
            });
          }

          // Aggregate totals to compute funnel-wide leak
          let totalCarts = 0;
          let totalCheckouts = 0;
          for (const k of productIds) {
            totalCarts += abandoned[k].carts;
            totalCheckouts += abandoned[k].checkouts;
          }
          const totalPurchasedCarts = (events ?? []).filter(
            (e) => e.type === "purchase_completed",
          ).length;
          const conversionRate =
            totalCarts + totalPurchasedCarts > 0
              ? totalPurchasedCarts / (totalCarts + totalPurchasedCarts)
              : 0;

          const insights: AgentInsightInput[] = [];
          for (const pid of productIds) {
            const p = byId.get(pid);
            if (!p) continue;
            const a = abandoned[pid];
            // Heuristic: 25% of abandoned cart sessions could be recovered with a reminder
            const recoverableSessions = Math.round(a.sessions.size * 0.25);
            const recoverableRevCents = recoverableSessions * (p.price_cents ?? 0);
            if (a.sessions.size < 3) continue; // skip noise
            const confidence = Math.min(
              0.9,
              0.5 + Math.min(a.sessions.size / 50, 1) * 0.3 + Math.min(a.checkouts / 20, 1) * 0.1,
            );
            const risk =
              recoverableRevCents > 50000 ? "high" : recoverableRevCents > 10000 ? "medium" : "low";
            insights.push({
              tenant_id: tenantId,
              insight_type: "aov_leak",
              affected_layer: "recovery",
              title: `${p.name}: ${a.sessions.size} покинутих кошиків за ${WINDOW_DAYS}д`,
              description: `З ${a.sessions.size} сесій, де "${p.name}" додали до кошика, жодна не завершила оплату. ${a.checkouts} дійшли до оформлення, але не оплатили. Надішліть листа про покинутий кошик зі знижкою 10% — типовий відсоток повернення ~25%.`,
              expected_impact: `Повернути ~${(recoverableRevCents / 100).toFixed(2)} ₴ (~${recoverableSessions} замовлень)`,
              confidence,
              risk_level: risk,
              metrics: {
                product_id: pid,
                product_name: p.name,
                sku: p.sku,
                abandoned_sessions: a.sessions.size,
                abandoned_carts: a.carts,
                abandoned_checkouts: a.checkouts,
                price_cents: p.price_cents,
                recoverable_sessions: recoverableSessions,
                recoverable_revenue_cents: recoverableRevCents,
                funnel_conversion_rate: Number(conversionRate.toFixed(4)),
                suggested_action: "abandoned_cart_email",
                suggested_discount_pct: 10,
              },
              dedup_key: `product:${pid}`,
            });
          }

          insights.sort((a, b) => {
            const am = a.metrics as { recoverable_revenue_cents?: number };
            const bm = b.metrics as { recoverable_revenue_cents?: number };
            return (bm.recoverable_revenue_cents ?? 0) - (am.recoverable_revenue_cents ?? 0);
          });

          const created = await insertInsightsDedup(insights.slice(0, 25));
          await finishAgentRun(handle, created, {
            events_scanned: events?.length ?? 0,
            leaky_products: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            events_scanned: events?.length ?? 0,
            leaky_products: insights.length,
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
