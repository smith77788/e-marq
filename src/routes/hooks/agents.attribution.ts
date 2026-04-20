/**
 * Attribution Agent — присвоює кожному paid order first/last touch channel
 * на основі events за 30 днів до покупки (по session_id або user_id).
 *
 * Канали витягуємо з events.payload.utm_source/channel або з payload.referrer.
 * Записує в `channel_attribution`, генерує insight якщо один канал доминує
 * (>60% revenue) — означає концентраційний ризик.
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

const AGENT_ID = "attribution";

type OrderRow = {
  id: string;
  customer_user_id: string | null;
  customer_email: string | null;
  total_cents: number;
  paid_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type EventRow = {
  user_id: string | null;
  session_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

function inferChannel(payload: Record<string, unknown> | null): string {
  if (!payload) return "direct";
  const utm = (payload.utm_source as string | undefined) ?? (payload.channel as string | undefined);
  if (utm) return String(utm).toLowerCase();
  const ref = payload.referrer as string | undefined;
  if (!ref) return "direct";
  const r = ref.toLowerCase();
  if (r.includes("google")) return "google";
  if (r.includes("facebook") || r.includes("fb.com")) return "facebook";
  if (r.includes("instagram")) return "instagram";
  if (r.includes("tiktok")) return "tiktok";
  if (r.includes("youtube")) return "youtube";
  if (r.includes("t.me") || r.includes("telegram")) return "telegram";
  return "referral";
}

export const Route = createFileRoute("/hooks/agents/attribution")({
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
          // Last 14 days of paid orders that don't yet have channel_attribution
          const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
          const { data: orderData, error: orderErr } = await supabaseAdmin
            .from("orders")
            .select("id, customer_user_id, customer_email, total_cents, paid_at, created_at, metadata")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("created_at", since)
            .limit(2_000);
          if (orderErr) throw orderErr;
          const orders = (orderData ?? []) as OrderRow[];
          if (orders.length === 0) {
            await finishAgentRun(handle, 0, { orders: 0 });
            return jsonOk({ run_id: handle.runId, orders: 0, insights_created: 0 });
          }

          const orderIds = orders.map((o) => o.id);
          const { data: existing } = await supabaseAdmin
            .from("channel_attribution")
            .select("order_id")
            .in("order_id", orderIds);
          const done = new Set((existing ?? []).map((e) => e.order_id));
          const todo = orders.filter((o) => !done.has(o.id));

          // Get last 30d of events per user/session
          const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const userIds = todo.map((o) => o.customer_user_id).filter((u): u is string => !!u);
          const { data: evData } = userIds.length
            ? await supabaseAdmin
                .from("events")
                .select("user_id, session_id, payload, created_at")
                .eq("tenant_id", tenantId)
                .in("user_id", userIds)
                .gte("created_at", since30)
                .order("created_at", { ascending: true })
                .limit(20_000)
            : { data: [] as EventRow[] };

          const events = (evData ?? []) as EventRow[];
          const byUser = new Map<string, EventRow[]>();
          for (const e of events) {
            if (!e.user_id) continue;
            const arr = byUser.get(e.user_id) ?? [];
            arr.push(e);
            byUser.set(e.user_id, arr);
          }

          const channelRevenue = new Map<string, number>();
          const insertRows: Array<Record<string, unknown>> = [];
          for (const o of todo) {
            let firstCh = "direct";
            let lastCh = "direct";
            const touchpoints: Array<{ channel: string; at: string }> = [];
            if (o.customer_user_id) {
              const list = byUser.get(o.customer_user_id) ?? [];
              const before = list.filter(
                (e) => new Date(e.created_at) <= new Date(o.paid_at ?? o.created_at),
              );
              if (before.length) {
                firstCh = inferChannel(before[0].payload);
                lastCh = inferChannel(before[before.length - 1].payload);
                for (const e of before.slice(0, 10)) {
                  touchpoints.push({ channel: inferChannel(e.payload), at: e.created_at });
                }
              }
            }
            // Fallback to order metadata (utm pinned at checkout)
            if (firstCh === "direct" && o.metadata) {
              const m = o.metadata as Record<string, unknown>;
              const utm = (m.utm_source as string | undefined) ?? (m.channel as string | undefined);
              if (utm) {
                firstCh = String(utm).toLowerCase();
                lastCh = firstCh;
              }
            }
            channelRevenue.set(lastCh, (channelRevenue.get(lastCh) ?? 0) + o.total_cents);
            insertRows.push({
              tenant_id: tenantId,
              order_id: o.id,
              customer_id: null,
              first_touch_channel: firstCh,
              last_touch_channel: lastCh,
              attribution_model: "last_touch",
              attributed_revenue: { [lastCh]: o.total_cents } as never,
              touchpoints: touchpoints as never,
            });
          }

          let inserted = 0;
          for (let i = 0; i < insertRows.length; i += 200) {
            const chunk = insertRows.slice(i, i + 200);
            const { error } = await supabaseAdmin
              .from("channel_attribution")
              .insert(chunk as never);
            if (!error) inserted += chunk.length;
          }

          // Insight: channel concentration risk
          const totalRev = Array.from(channelRevenue.values()).reduce((s, x) => s + x, 0);
          const insights: AgentInsightInput[] = [];
          for (const [ch, rev] of channelRevenue) {
            if (totalRev < 100_000) continue; // <$1000 — too small
            const share = rev / totalRev;
            if (share >= 0.6 && ch !== "direct") {
              insights.push({
                tenant_id: tenantId,
                insight_type: "channel_concentration_risk",
                affected_layer: "growth",
                title: `Канал "${ch}" дає ${(share * 100).toFixed(0)}% виторгу`,
                description: `За останні 14 днів ${(share * 100).toFixed(0)}% усього доходу прийшло з одного джерела (${ch}). Якщо канал зламається — впаде половина бізнесу.`,
                expected_impact: `Диверсифікація на 2-й канал зменшить ризик. Цільова частка — <50% з одного джерела.`,
                confidence: 0.8,
                risk_level: "high",
                metrics: {
                  dominant_channel: ch,
                  share,
                  revenue_cents: rev,
                  total_revenue_cents: totalRev,
                  channel_breakdown: Object.fromEntries(channelRevenue),
                  suggested_action: "diversify_channels",
                },
                dedup_key: `channel_concentration::${ch}`,
              });
              break;
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            orders: orders.length,
            attributed: inserted,
            channels: Object.fromEntries(channelRevenue),
          });
          return jsonOk({
            run_id: handle.runId,
            orders: orders.length,
            attributed: inserted,
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
