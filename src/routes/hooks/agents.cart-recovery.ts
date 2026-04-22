/**
 * Cart Recovery (ported from MFD `acos-cart-recovery` + `acos-cart-recovery-tracker`).
 *
 * Знаходить сесії, де був add_to_cart АЛЕ не було purchase за наступні 60 хв.
 * Якщо сесія прив'язана до customer_id (через email/user_id) — створює
 * cart_recovery_attempt запис і insight.
 *
 * Window: останні 24 год (cron щогодини).
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

export const Route = createFileRoute("/hooks/agents/cart-recovery")({
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

        const handle = await startAgentRun("cart-recovery", tenantId, ctx);
        try {
          const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

          // Step 1: get add_to_cart events with session_id
          const { data: cartEvents } = await supabaseAdmin
            .from("events")
            .select("session_id, product_id, payload, user_id, created_at")
            .eq("tenant_id", tenantId)
            .eq("type", "add_to_cart")
            .gte("created_at", since)
            .not("session_id", "is", null);

          if (!cartEvents?.length) {
            await finishAgentRun(handle, 0, { reason: "no_cart_events" });
            return jsonOk({ insights_created: 0, abandoned: 0 });
          }

          // Group by session_id
          const sessions = new Map<
            string,
            { products: string[]; latest: string; userId: string | null; value: number }
          >();
          for (const e of cartEvents) {
            const sid = e.session_id!;
            const existing = sessions.get(sid) ?? {
              products: [],
              latest: e.created_at,
              userId: e.user_id,
              value: 0,
            };
            if (e.product_id) existing.products.push(e.product_id);
            if (e.created_at > existing.latest) existing.latest = e.created_at;
            const payload = e.payload as Record<string, unknown> | null;
            const priceCents =
              typeof payload?.price_cents === "number" ? (payload.price_cents as number) : 0;
            existing.value += priceCents;
            sessions.set(sid, existing);
          }

          // Step 2: filter sessions that did NOT lead to purchase within 60 min
          const sessionIds = Array.from(sessions.keys());
          const { data: purchases } = await supabaseAdmin
            .from("events")
            .select("session_id")
            .eq("tenant_id", tenantId)
            .eq("type", "purchase_completed")
            .in("session_id", sessionIds);
          const purchasedSet = new Set((purchases ?? []).map((p) => p.session_id));

          // Step 3: filter to "abandoned" — latest cart event >60 min ago AND no purchase
          const cutoff = Date.now() - 60 * 60 * 1000;
          const abandoned: {
            sessionId: string;
            data: typeof sessions extends Map<string, infer V> ? V : never;
          }[] = [];
          for (const [sid, data] of sessions) {
            if (purchasedSet.has(sid)) continue;
            if (new Date(data.latest).getTime() > cutoff) continue;
            abandoned.push({ sessionId: sid, data });
          }

          // Step 4: try to map to customers via user_id
          const userIds = abandoned.map((a) => a.data.userId).filter((u): u is string => !!u);
          const { data: matchedCustomers } = userIds.length
            ? await supabaseAdmin
                .from("customers")
                .select("id, user_id, email, name")
                .eq("tenant_id", tenantId)
                .in("user_id", userIds)
            : { data: [] };
          const userToCustomer = new Map((matchedCustomers ?? []).map((c) => [c.user_id, c]));

          // Step 5: dedupe — check existing cart_recovery_attempts last 7d
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
          const { data: existingAttempts } = await supabaseAdmin
            .from("cart_recovery_attempts")
            .select("session_id")
            .eq("tenant_id", tenantId)
            .gte("created_at", sevenDaysAgo)
            .in(
              "session_id",
              abandoned.map((a) => a.sessionId),
            );
          const attemptedSet = new Set((existingAttempts ?? []).map((a) => a.session_id));

          const newAttempts = abandoned.filter((a) => !attemptedSet.has(a.sessionId));

          // Step 6: insert attempts + insights
          const attemptRows = newAttempts.map((a) => {
            const customer = a.data.userId ? userToCustomer.get(a.data.userId) : null;
            return {
              tenant_id: tenantId,
              customer_id: customer?.id ?? null,
              session_id: a.sessionId,
              cart_value_cents: a.data.value,
              cart_items: a.data.products.map((pid) => ({ product_id: pid })),
              abandoned_at: a.data.latest,
              attempt_number: 1,
              channel: "email",
            };
          });
          if (attemptRows.length) {
            const { error } = await supabaseAdmin
              .from("cart_recovery_attempts")
              .insert(attemptRows);
            if (error) throw error;
          }

          // Insights only for cases with mappable customer + decent cart value
          const insights = newAttempts
            .filter((a) => {
              const customer = a.data.userId ? userToCustomer.get(a.data.userId) : null;
              return customer && a.data.value >= 1000; // $10+
            })
            .map((a) => {
              const customer = userToCustomer.get(a.data.userId!)!;
              return {
                tenant_id: tenantId,
                insight_type: "cart_abandoned",
                affected_layer: "conversion",
                title: `${customer.name || customer.email}: покинутий кошик ${formatCents(a.data.value)}`,
                description: `Додав ${a.data.products.length} товарів і не оформив за 60+ хв.`,
                expected_impact: `Recovery email конвертить ~15-20% — потенційно ${formatCents(Math.round(a.data.value * 0.18))} назад.`,
                confidence: 0.75,
                risk_level: "low" as const,
                metrics: {
                  customer_id: customer.id,
                  customer_name: customer.name,
                  customer_email: customer.email,
                  cart_value_cents: a.data.value,
                  product_count: a.data.products.length,
                  product_ids: a.data.products,
                  session_id: a.sessionId,
                  abandoned_at: a.data.latest,
                },
                dedup_key: `cart_abandon::${a.sessionId}`,
              };
            });

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            abandoned: abandoned.length,
            new_attempts: attemptRows.length,
          });
          return jsonOk({
            insights_created: created,
            abandoned: abandoned.length,
            new_attempts: attemptRows.length,
          });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Cart recovery failed", 500, {
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
