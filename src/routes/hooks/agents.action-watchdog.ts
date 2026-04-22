/**
 * Action Watchdog — стежить за ai_actions, які були applied ≥ 7 днів тому
 * але ніколи не отримали measurement (measured_at IS NULL).
 *
 * Створює insight, що "loop не закритий" — це системний risk: ШІ не вчиться
 * на власних діях.
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

const AGENT_ID = "action-watchdog";

export const Route = createFileRoute("/hooks/agents/action-watchdog")({
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
          const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("ai_actions")
            .select("id, agent_id, action_type, applied_at, measured_at, status")
            .eq("tenant_id", tenantId)
            .eq("status", "applied")
            .lte("applied_at", cutoff)
            .is("measured_at", null)
            .limit(500);
          if (error) throw error;

          const stale = data ?? [];
          if (stale.length === 0) {
            await finishAgentRun(handle, 0, { stale_actions: 0 });
            return jsonOk({ insights_created: 0 });
          }

          // Group by agent_id to give one consolidated insight per agent
          const byAgent = new Map<string, typeof stale>();
          for (const a of stale) {
            const arr = byAgent.get(a.agent_id) ?? [];
            arr.push(a);
            byAgent.set(a.agent_id, arr);
          }

          const insights: AgentInsightInput[] = [];
          for (const [agentId, actions] of byAgent) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "action_loop_unclosed",
              affected_layer: "system",
              title: `${agentId}: ${actions.length} дій без вимірювання ≥ 7 днів`,
              description: `Ці дії застосовано, але impact ще не виміряно — система не може навчатись на результатах.`,
              expected_impact:
                "Запустити feedback-loop для цих дій або позначити їх як measured вручну, щоб ШІ міг адаптуватись.",
              confidence: 0.95,
              risk_level: actions.length >= 10 ? "high" : "medium",
              metrics: {
                agent_id: agentId,
                stale_count: actions.length,
                action_ids: actions.map((a) => a.id),
                action_types: Array.from(new Set(actions.map((a) => a.action_type))),
                suggested_action: "trigger_feedback_loop",
              },
              dedup_key: `watchdog::${agentId}::${new Date().toISOString().slice(0, 10)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            stale_actions: stale.length,
            agents_affected: byAgent.size,
          });
          return jsonOk({
            run_id: handle.runId,
            stale_actions: stale.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Action watchdog failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
