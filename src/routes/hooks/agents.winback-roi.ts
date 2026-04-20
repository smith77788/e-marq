/**
 * Winback ROI — рахує ефективність winback-engine за останні 60 днів.
 * Вимірює: відправлено / відповіли / купили / revenue. Порівнює з
 * baseline-revenue за період. Якщо ROI < 0.5× від cart-recovery → insight
 * "engine треба налаштовувати". Якщо ROI > 2× → "масштабувати — більша cadence".
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
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "winback-roi";

type Row = {
  trigger_kind: string;
  actual_revenue_cents: number | null;
  converted_at: string | null;
  replied_at: string | null;
};

export const Route = createFileRoute("/hooks/agents/winback-roi")({
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
          const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("outbound_messages")
            .select("trigger_kind, actual_revenue_cents, converted_at, replied_at")
            .eq("tenant_id", tenantId)
            .in("trigger_kind", ["winback", "abandoned_cart", "reorder"])
            .not("sent_at", "is", null)
            .gte("sent_at", since)
            .limit(50_000);
          if (error) throw error;
          const rows = (data ?? []) as Row[];

          type Stat = { sent: number; replied: number; converted: number; revenue: number };
          const stats: Record<string, Stat> = {
            winback: { sent: 0, replied: 0, converted: 0, revenue: 0 },
            abandoned_cart: { sent: 0, replied: 0, converted: 0, revenue: 0 },
            reorder: { sent: 0, replied: 0, converted: 0, revenue: 0 },
          };
          for (const r of rows) {
            const s = stats[r.trigger_kind];
            if (!s) continue;
            s.sent++;
            if (r.replied_at) s.replied++;
            if (r.converted_at) s.converted++;
            s.revenue += r.actual_revenue_cents ?? 0;
          }
          const winback = stats.winback;
          const insights: AgentInsightInput[] = [];

          if (winback.sent < 20) {
            await finishAgentRun(handle, 0, { reason: "insufficient_winback_volume", stats });
            return jsonOk({ run_id: handle.runId, stats, insights_created: 0 });
          }

          const winbackRoi = winback.revenue / winback.sent;
          const winbackConv = winback.converted / winback.sent;
          // baseline = avg ROI of other triggers
          const others = ["abandoned_cart", "reorder"]
            .map((k) => stats[k])
            .filter((s) => s.sent >= 20);
          const baselineRoi =
            others.length > 0
              ? others.reduce((a, s) => a + s.revenue / Math.max(s.sent, 1), 0) / others.length
              : winbackRoi;

          if (winbackRoi >= baselineRoi * 1.5 && winbackConv >= 0.05) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "winback_high_roi",
              affected_layer: "marketing",
              title: `Winback працює: ${(winbackConv * 100).toFixed(1)}% конверсія, ROI ${(winbackRoi / 100).toFixed(2)}/msg`,
              description: `${winback.sent} надсилань, ${winback.converted} покупок, ${(winback.revenue / 100).toFixed(0)}$ виторгу. ROI у ${(winbackRoi / Math.max(baselineRoi, 1)).toFixed(1)}× вище за інші nurture-канали.`,
              expected_impact:
                "Збільш cadence winback (наприклад, з 90 до 60 днів no-order trigger) — дасть ще +30% revenue.",
              confidence: 0.8,
              risk_level: "low",
              metrics: {
                winback_sent: winback.sent,
                winback_converted: winback.converted,
                winback_revenue_cents: winback.revenue,
                winback_roi_per_msg_cents: winbackRoi,
                winback_conversion_rate: winbackConv,
                baseline_roi_per_msg_cents: baselineRoi,
                suggested_action: "increase_winback_cadence",
              },
              dedup_key: `winback_high::${new Date().toISOString().slice(0, 7)}`,
            });
          } else if (winbackRoi < baselineRoi * 0.5 || winbackConv < 0.005) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "winback_low_roi",
              affected_layer: "marketing",
              title: `Winback слабкий: ${(winbackConv * 100).toFixed(2)}% конверсія, ROI ${(winbackRoi / 100).toFixed(2)}/msg`,
              description: `${winback.sent} надсилань, тільки ${winback.converted} покупок. Нижче ${(baselineRoi / 100).toFixed(2)}/msg в інших каналах — або таргетинг не той, або шаблон не цикає.`,
              expected_impact:
                "Знизь cadence (no-order trigger з 90 до 120 днів), додай discount для першого повторного замовлення, або переписати tone.",
              confidence: 0.7,
              risk_level: "medium",
              metrics: {
                winback_sent: winback.sent,
                winback_converted: winback.converted,
                winback_revenue_cents: winback.revenue,
                winback_roi_per_msg_cents: winbackRoi,
                winback_conversion_rate: winbackConv,
                baseline_roi_per_msg_cents: baselineRoi,
                suggested_action: "tune_winback_or_add_offer",
              },
              dedup_key: `winback_low::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { stats, baseline_roi: baselineRoi });
          return jsonOk({
            run_id: handle.runId,
            stats,
            baseline_roi_per_msg_cents: baselineRoi,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Winback ROI failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
