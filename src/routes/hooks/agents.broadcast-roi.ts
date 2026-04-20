/**
 * Broadcast ROI — групує outbound_messages з trigger_kind='broadcast'
 * по template_key (≈ окремі broadcast-кампанії), рахує ROI на повідомлення
 * та відсоток відповідей. Знаходить broadcast'и-переможці (ROI > 2x avg)
 * та слабкі (ROI < 0.3x avg) для подальшого масштабування / паузи.
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

const AGENT_ID = "broadcast-roi";

type Row = {
  template_key: string | null;
  actual_revenue_cents: number | null;
  replied_at: string | null;
  converted_at: string | null;
};

export const Route = createFileRoute("/hooks/agents/broadcast-roi")({
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
            .select("template_key, actual_revenue_cents, replied_at, converted_at")
            .eq("tenant_id", tenantId)
            .eq("trigger_kind", "broadcast")
            .not("sent_at", "is", null)
            .gte("sent_at", since)
            .limit(50_000);
          if (error) throw error;
          const rows = (data ?? []) as Row[];
          if (rows.length < 30) {
            await finishAgentRun(handle, 0, { rows: rows.length, reason: "insufficient_volume" });
            return jsonOk({ run_id: handle.runId, rows: rows.length, insights_created: 0 });
          }

          type Stat = { count: number; revenue: number; replies: number; conv: number };
          const byTemplate = new Map<string, Stat>();
          let totalRev = 0;
          let totalCount = 0;
          for (const r of rows) {
            const key = r.template_key || "unspecified";
            const s = byTemplate.get(key) ?? { count: 0, revenue: 0, replies: 0, conv: 0 };
            s.count++;
            s.revenue += r.actual_revenue_cents ?? 0;
            if (r.replied_at) s.replies++;
            if (r.converted_at) s.conv++;
            byTemplate.set(key, s);
            totalRev += r.actual_revenue_cents ?? 0;
            totalCount++;
          }
          const avgRoi = totalCount > 0 ? totalRev / totalCount : 0;

          const insights: AgentInsightInput[] = [];
          const breakdown: Record<
            string,
            { count: number; revenue: number; roi_per_msg: number; reply_rate: number; conv_rate: number }
          > = {};

          for (const [tmpl, s] of byTemplate) {
            const roi = s.count > 0 ? s.revenue / s.count : 0;
            const replyRate = s.count > 0 ? s.replies / s.count : 0;
            const convRate = s.count > 0 ? s.conv / s.count : 0;
            breakdown[tmpl] = {
              count: s.count,
              revenue: s.revenue,
              roi_per_msg: roi,
              reply_rate: replyRate,
              conv_rate: convRate,
            };
            if (s.count < 20) continue;

            if (avgRoi > 0 && roi >= avgRoi * 2) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "broadcast_winner",
                affected_layer: "marketing",
                title: `Broadcast "${tmpl}" — переможець (ROI ${(roi / 100).toFixed(2)}/msg)`,
                description: `${s.count} надсилань, конверсія ${(convRate * 100).toFixed(1)}%, ROI у ${(roi / Math.max(avgRoi, 1)).toFixed(1)}× вище за середній broadcast.`,
                expected_impact: `Перевипуск з ширшою аудиторією дасть приблизно +${((roi * s.count) / 100).toFixed(0)}$ revenue.`,
                confidence: 0.8,
                risk_level: "low",
                metrics: {
                  template_key: tmpl,
                  count: s.count,
                  revenue_cents: s.revenue,
                  roi_per_msg_cents: roi,
                  reply_rate: replyRate,
                  conversion_rate: convRate,
                  avg_roi_per_msg_cents: avgRoi,
                  suggested_action: "rerun_with_wider_audience",
                },
                dedup_key: `broadcast_winner::${tmpl}`,
              });
            } else if (avgRoi > 0 && roi < avgRoi * 0.3 && convRate < 0.01) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "broadcast_dud",
                affected_layer: "marketing",
                title: `Broadcast "${tmpl}" не працює (ROI ${(roi / 100).toFixed(2)}/msg)`,
                description: `${s.count} надсилань, конверсія ${(convRate * 100).toFixed(2)}%, reply rate ${(replyRate * 100).toFixed(1)}% — це шум, який знижує trust до бренду.`,
                expected_impact: "Призупини цей шаблон або переписати hook першого рядка через ШІ.",
                confidence: 0.75,
                risk_level: "medium",
                metrics: {
                  template_key: tmpl,
                  count: s.count,
                  revenue_cents: s.revenue,
                  roi_per_msg_cents: roi,
                  reply_rate: replyRate,
                  conversion_rate: convRate,
                  avg_roi_per_msg_cents: avgRoi,
                  suggested_action: "pause_or_rewrite",
                },
                dedup_key: `broadcast_dud::${tmpl}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            templates: byTemplate.size,
            avg_roi_per_msg_cents: avgRoi,
            breakdown,
          });
          return jsonOk({
            run_id: handle.runId,
            templates: byTemplate.size,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Broadcast ROI failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
