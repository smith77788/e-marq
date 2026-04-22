/**
 * Nurture ROI — оцінює ROI кожного trigger_kind у outbound_messages
 * за останні 30 днів. ROI = sum(actual_revenue) / count(sent).
 * Insight, якщо є trigger з ROI <0.5× від середнього (марнотратний)
 * або ROI >2× (масштабувати).
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

const AGENT_ID = "nurture-roi";

type Row = { trigger_kind: string; actual_revenue_cents: number | null; sent_at: string | null };

export const Route = createFileRoute("/hooks/agents/nurture-roi")({
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
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("outbound_messages")
            .select("trigger_kind, actual_revenue_cents, sent_at")
            .eq("tenant_id", tenantId)
            .not("sent_at", "is", null)
            .gte("sent_at", since)
            .limit(50_000);
          if (error) throw error;
          const rows = (data ?? []) as Row[];
          if (rows.length < 20) {
            await finishAgentRun(handle, 0, { rows: rows.length, reason: "insufficient_data" });
            return jsonOk({ run_id: handle.runId, rows: rows.length, insights_created: 0 });
          }

          type Stat = { count: number; revenue: number };
          const byTrigger = new Map<string, Stat>();
          let totalRev = 0;
          let totalCount = 0;
          for (const r of rows) {
            const t = r.trigger_kind || "unknown";
            const s = byTrigger.get(t) ?? { count: 0, revenue: 0 };
            s.count++;
            const rev = r.actual_revenue_cents ?? 0;
            s.revenue += rev;
            byTrigger.set(t, s);
            totalRev += rev;
            totalCount += 1;
          }
          const avgRoi = totalCount > 0 ? totalRev / totalCount : 0;

          const insights: AgentInsightInput[] = [];
          const breakdown: Record<string, { count: number; revenue: number; roi_per_msg: number }> =
            {};
          for (const [trigger, s] of byTrigger) {
            const roi = s.count > 0 ? s.revenue / s.count : 0;
            breakdown[trigger] = { count: s.count, revenue: s.revenue, roi_per_msg: roi };
            if (s.count < 10) continue; // need volume

            if (avgRoi > 0 && roi < avgRoi * 0.5) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "nurture_low_roi",
                affected_layer: "marketing",
                title: `Trigger "${trigger}" втрачає гроші (ROI ${(roi / 100).toFixed(2)}/msg)`,
                description: `${s.count} надсилань, ROI ${(roi / 100).toFixed(2)}/msg vs середнє ${(avgRoi / 100).toFixed(2)}. Це канал, який жере час та довіру без віддачі.`,
                expected_impact: `Пауза цього trigger звільнить attention для тих, що працюють. Орієнтовно: +${(((avgRoi - roi) * s.count) / 100).toFixed(0)}$ revenue, якщо переключити на середнього перформера.`,
                confidence: 0.7,
                risk_level: "medium",
                metrics: {
                  trigger,
                  count: s.count,
                  revenue_cents: s.revenue,
                  roi_per_msg_cents: roi,
                  avg_roi_per_msg_cents: avgRoi,
                  ratio: avgRoi > 0 ? roi / avgRoi : 0,
                  suggested_action: "pause_low_roi_trigger",
                },
                dedup_key: `nurture_low::${trigger}`,
              });
            } else if (roi >= avgRoi * 2 && avgRoi > 0) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "nurture_high_roi",
                affected_layer: "marketing",
                title: `Trigger "${trigger}" — зірка (ROI ${(roi / 100).toFixed(2)}/msg)`,
                description: `${s.count} надсилань, ROI у ${(roi / Math.max(avgRoi, 1)).toFixed(1)}× вище за середнє. Чому ми не масштабуємо це?`,
                expected_impact: `Подвоєння обʼємів цього trigger дасть приблизно +${((roi * s.count) / 100).toFixed(0)}$ revenue/місяць.`,
                confidence: 0.75,
                risk_level: "low",
                metrics: {
                  trigger,
                  count: s.count,
                  revenue_cents: s.revenue,
                  roi_per_msg_cents: roi,
                  avg_roi_per_msg_cents: avgRoi,
                  ratio: roi / avgRoi,
                  suggested_action: "scale_high_roi_trigger",
                },
                dedup_key: `nurture_high::${trigger}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            triggers: byTrigger.size,
            avg_roi: avgRoi,
            breakdown,
          });
          return jsonOk({
            run_id: handle.runId,
            triggers: byTrigger.size,
            avg_roi_per_msg_cents: avgRoi,
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
