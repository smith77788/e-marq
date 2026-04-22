/**
 * First-Order Funnel (ported from MFD `acos-first-order-funnel`).
 *
 * Аналізує конверсію саме НОВИХ відвідувачів (без замовлень) у перший платіж:
 * session_start → product_viewed → checkout_started → purchase_completed,
 * але тільки для session_id які ніколи раніше не платили.
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

export const Route = createFileRoute("/hooks/agents/first-order-funnel")({
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

        const handle = await startAgentRun("first-order-funnel", tenantId, ctx);
        try {
          const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

          const { data: events } = await supabaseAdmin
            .from("events")
            .select("session_id, type, user_id, created_at")
            .eq("tenant_id", tenantId)
            .gte("created_at", since)
            .in("type", [
              "session_start",
              "product_viewed",
              "add_to_cart",
              "checkout_started",
              "purchase_completed",
            ]);

          if (!events?.length) {
            await finishAgentRun(handle, 0, { reason: "no_events" });
            return jsonOk({ insights_created: 0 });
          }

          // Identify "first-time" sessions: session_id with no prior purchase by same user_id (or with no user_id at all)
          const sessionsByUser = new Map<string, Set<string>>();
          const purchasedSessions = new Set<string>();
          for (const e of events) {
            if (!e.session_id) continue;
            if (e.user_id) {
              const set = sessionsByUser.get(e.user_id) ?? new Set();
              set.add(e.session_id);
              sessionsByUser.set(e.user_id, set);
            }
            if (e.type === "purchase_completed") purchasedSessions.add(e.session_id);
          }

          // For users with multiple sessions, classify their first session only
          const firstSessions = new Set<string>();
          const seenByUser = new Set<string>();
          for (const e of events.sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          )) {
            if (!e.session_id) continue;
            const userKey = e.user_id ?? `anon:${e.session_id}`;
            if (!seenByUser.has(userKey)) {
              firstSessions.add(e.session_id);
              seenByUser.add(userKey);
            }
          }

          // Per-step counters scoped to first sessions
          const steps = [
            "session_start",
            "product_viewed",
            "add_to_cart",
            "checkout_started",
            "purchase_completed",
          ];
          const counters: Record<string, Set<string>> = Object.fromEntries(
            steps.map((s) => [s, new Set<string>()]),
          );
          for (const e of events) {
            if (!e.session_id || !firstSessions.has(e.session_id)) continue;
            counters[e.type]?.add(e.session_id);
          }

          const funnel = steps.map((s) => ({ step: s, count: counters[s].size }));
          const totalStarts = funnel[0].count;
          if (totalStarts < 20) {
            await finishAgentRun(handle, 0, { reason: "low_traffic", total_starts: totalStarts });
            return jsonOk({ insights_created: 0 });
          }

          // Identify weakest step (biggest drop %)
          let worst = { from: "", to: "", drop: 0, fromCount: 0, toCount: 0 };
          for (let i = 1; i < funnel.length; i++) {
            const prev = funnel[i - 1].count;
            const cur = funnel[i].count;
            if (prev === 0) continue;
            const drop = 1 - cur / prev;
            if (drop > worst.drop) {
              worst = {
                from: funnel[i - 1].step,
                to: funnel[i].step,
                drop,
                fromCount: prev,
                toCount: cur,
              };
            }
          }

          const overallConv = funnel[4].count / totalStarts;
          const benchmark = 0.02; // 2% first-order conversion benchmark for D2C

          const insights: Parameters<typeof insertInsightsDedup>[0] = [];
          if (overallConv < benchmark) {
            insights.push({
              tenant_id: tenantId!,
              insight_type: "first_order_funnel_weak",
              affected_layer: "funnel",
              title: `First-order conversion: ${(overallConv * 100).toFixed(2)}% (нижче ${(benchmark * 100).toFixed(0)}%)`,
              description: `${totalStarts} нових сесій → ${funnel[4].count} перших покупок за 30д. Найбільший провал: ${worst.from} → ${worst.to} (-${(worst.drop * 100).toFixed(0)}%).`,
              expected_impact: `Закриття одного слабкого кроку зазвичай дає 1.3-2× ріст first-order revenue.`,
              confidence: 0.8,
              risk_level: "medium",
              metrics: {
                total_starts: totalStarts,
                completed: funnel[4].count,
                conversion: overallConv,
                benchmark,
                weakest_from: worst.from,
                weakest_to: worst.to,
                weakest_drop: worst.drop,
                funnel,
              },
              dedup_key: `first-order-funnel::${new Date().toISOString().slice(0, 10)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            total_starts: totalStarts,
            conversion: overallConv,
            funnel,
          });
          return jsonOk({ insights_created: created, funnel });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("First-order funnel failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
