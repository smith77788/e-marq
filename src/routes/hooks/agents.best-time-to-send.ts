/**
 * Best Time To Send — analyses outbound_messages of last 60 days, computes
 * conversion-by-hour-of-day (UTC) і знаходить top-3 години та worst-3.
 * Insight, якщо різниця conversion >2× між найкращою та середньою.
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

const AGENT_ID = "best-time-to-send";

type Row = { sent_at: string | null; converted_at: string | null };

export const Route = createFileRoute("/hooks/agents/best-time-to-send")({
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
            .select("sent_at, converted_at")
            .eq("tenant_id", tenantId)
            .not("sent_at", "is", null)
            .gte("sent_at", since)
            .limit(20_000);
          if (error) throw error;
          const rows = (data ?? []) as Row[];
          if (rows.length < 50) {
            await finishAgentRun(handle, 0, { rows: rows.length, reason: "insufficient_data" });
            return jsonOk({ run_id: handle.runId, rows: rows.length, insights_created: 0 });
          }

          const sent = Array(24).fill(0) as number[];
          const conv = Array(24).fill(0) as number[];
          for (const r of rows) {
            if (!r.sent_at) continue;
            const h = new Date(r.sent_at).getUTCHours();
            sent[h]++;
            if (r.converted_at) conv[h]++;
          }
          const rates = sent.map((s, i) => (s >= 5 ? conv[i] / s : null));
          const valid = rates
            .map((r, h) => ({ h, r }))
            .filter((x): x is { h: number; r: number } => x.r !== null);
          if (valid.length < 6) {
            await finishAgentRun(handle, 0, { reason: "insufficient_hour_buckets" });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          const avg = valid.reduce((s, x) => s + x.r, 0) / valid.length;
          const sorted = [...valid].sort((a, b) => b.r - a.r);
          const top3 = sorted.slice(0, 3);
          const bottom3 = sorted.slice(-3);

          const insights: AgentInsightInput[] = [];
          if (top3.length && top3[0].r >= avg * 2 && avg > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "best_send_window",
              affected_layer: "marketing",
              title: `Найкращі години надсилання: ${top3.map((x) => `${x.h}:00`).join(", ")} UTC`,
              description: `Conversion у ці години у ${(top3[0].r / avg).toFixed(1)}× вище за середнє (${(avg * 100).toFixed(1)}%). Найгірші: ${bottom3.map((x) => `${x.h}:00`).join(", ")}.`,
              expected_impact: `Перенесення розсилок у топ-вікно дасть ~${(((top3[0].r - avg) / avg) * 100).toFixed(0)}% більше конверсій без зростання витрат.`,
              confidence: 0.75,
              risk_level: "low",
              metrics: {
                top_hours_utc: top3.map((x) => x.h),
                worst_hours_utc: bottom3.map((x) => x.h),
                top_rate: top3[0].r,
                avg_rate: avg,
                full_distribution: rates,
                suggested_action: "schedule_in_best_window",
              },
              dedup_key: `best_send::${top3.map((x) => x.h).join("-")}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { messages: rows.length, top3, bottom3 });
          return jsonOk({ run_id: handle.runId, messages: rows.length, insights_created: created });
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
