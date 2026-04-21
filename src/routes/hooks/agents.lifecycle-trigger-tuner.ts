/**
 * Lifecycle Trigger Tuner — порівнює конверсію lifecycle-тригерів
 * (welcome, winback, reorder тощо) і пропонує перерозподіл бюджету.
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

const AGENT_ID = "lifecycle-trigger-tuner";

export const Route = createFileRoute("/hooks/agents/lifecycle-trigger-tuner")({
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
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const { data: messages } = await supabaseAdmin
            .from("outbound_messages")
            .select("trigger_kind, status, actual_revenue_cents, expected_impact_cents, converted_at")
            .eq("tenant_id", tenantId)
            .gte("created_at", since)
            .limit(2000);

          const byTrigger = new Map<string, { sent: number; converted: number; revenue: number }>();
          for (const m of messages ?? []) {
            const e = byTrigger.get(m.trigger_kind) ?? { sent: 0, converted: 0, revenue: 0 };
            if (m.status === "sent" || m.status === "delivered" || m.status === "converted") e.sent++;
            if (m.converted_at) {
              e.converted++;
              e.revenue += m.actual_revenue_cents ?? 0;
            }
            byTrigger.set(m.trigger_kind, e);
          }

          if (byTrigger.size < 2) {
            await finishAgentRun(handle, 0, { reason: "not_enough_triggers" });
            return jsonOk({ insights_created: 0 });
          }

          // Compute revenue per send
          const stats = Array.from(byTrigger.entries()).map(([k, v]) => ({
            trigger: k,
            sent: v.sent,
            cr: v.sent > 0 ? v.converted / v.sent : 0,
            rps: v.sent > 0 ? v.revenue / v.sent : 0,
            revenue: v.revenue,
          }));
          stats.sort((a, b) => b.rps - a.rps);
          const best = stats[0];
          const worst = stats[stats.length - 1];

          const insights: AgentInsightInput[] = [];
          if (best.sent >= 10 && worst.sent >= 10 && best.rps > worst.rps * 2) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "lifecycle_trigger_imbalance",
              affected_layer: "messaging",
              title: `📊 ${best.trigger} приносить у ${(best.rps / Math.max(worst.rps, 1)).toFixed(1)}× більше за ${worst.trigger}`,
              description: `${best.trigger}: ${(best.rps / 100).toFixed(2)} ₴/повідомлення (${best.sent} надіслано). ${worst.trigger}: ${(worst.rps / 100).toFixed(2)} ₴.`,
              expected_impact: `Перерозподіл +30% бюджету на ${best.trigger} → ~${((best.rps * worst.sent * 0.3) / 100).toFixed(0)} ₴/міс`,
              confidence: 0.75,
              risk_level: "low",
              metrics: {
                stats,
                best_trigger: best.trigger,
                worst_trigger: worst.trigger,
                suggested_action: "rebalance_lifecycle_budget",
              },
              dedup_key: `lifecycle-tune::${best.trigger}::${worst.trigger}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { triggers: byTrigger.size });
          return jsonOk({ insights_created: created });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Lifecycle trigger tuner failed", 500, { details: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  },
});
