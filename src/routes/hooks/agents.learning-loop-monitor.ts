/**
 * Learning Loop Monitor — стежить за здоров'ям ШІ-памʼяті.
 *
 * Перевіряє:
 *  1. Чи кожен великий агент має хоча б одну активну ai_memory-нотатку
 *     (інакше — він не вчиться).
 *  2. Памʼяті з failure_count > success_count * 2 → "негативне правило",
 *     треба деактивувати.
 *  3. Памʼяті, що не оновлювались > 60 днів і мають низький confidence
 *     → старіють, треба переоцінити.
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

const AGENT_ID = "learning-loop-monitor";

const CRITICAL_AGENTS = [
  "price-optimizer",
  "margin-optimizer",
  "ltv-predictor",
  "churn-risk",
  "cart-recovery",
  "bundle-recommender",
  "broadcast-composer",
];

export const Route = createFileRoute("/hooks/agents/learning-loop-monitor")({
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
          const { data, error } = await supabaseAdmin
            .from("ai_memory")
            .select(
              "id, agent, pattern_key, success_count, failure_count, confidence, is_active, last_observed_at, learned_rule",
            )
            .eq("tenant_id", tenantId)
            .limit(5000);
          if (error) throw error;
          const memories = data ?? [];

          const byAgent = new Map<string, typeof memories>();
          for (const m of memories) {
            const arr = byAgent.get(m.agent) ?? [];
            arr.push(m);
            byAgent.set(m.agent, arr);
          }

          const insights: AgentInsightInput[] = [];

          // 1. agents without active memory
          const agentsWithoutMemory = CRITICAL_AGENTS.filter((a) => {
            const mems = byAgent.get(a) ?? [];
            return mems.filter((m) => m.is_active).length === 0;
          });
          if (agentsWithoutMemory.length > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "learning_loop_silent_agents",
              affected_layer: "system",
              title: `${agentsWithoutMemory.length} агентів не вчаться`,
              description: `${agentsWithoutMemory.join(", ")} не мають активних ai_memory-записів — означає, що feedback-loop не запускався або не знайшов патернів.`,
              expected_impact:
                "Запусти agents/feedback-loop-all вручну та перевір що actions цих агентів отримують measured_at.",
              confidence: 0.9,
              risk_level: "medium",
              metrics: {
                silent_agents: agentsWithoutMemory,
                suggested_action: "run_feedback_loop_all",
              },
              dedup_key: `learning_silent::${agentsWithoutMemory.sort().join(",")}`,
            });
          }

          // 2. negative rules
          const negative = memories.filter(
            (m) => m.is_active && m.failure_count > m.success_count * 2 && m.failure_count >= 3,
          );
          if (negative.length > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "learning_loop_negative_rules",
              affected_layer: "system",
              title: `${negative.length} активних правил систематично провалюються`,
              description: `Памʼяті з failure ≥ 2× success — ШІ має на них спиратись як на анти-патерни або повністю деактивувати.`,
              expected_impact:
                "Деактивуй ці правила або інвертуй (success → don't, failure → do). Ризик: ШІ продовжує робити те, що шкодить.",
              confidence: 0.85,
              risk_level: "high",
              metrics: {
                count: negative.length,
                examples: negative.slice(0, 5).map((m) => ({
                  pattern_key: m.pattern_key,
                  agent: m.agent,
                  rule: m.learned_rule,
                  success: m.success_count,
                  failure: m.failure_count,
                })),
                suggested_action: "deactivate_or_invert",
              },
              dedup_key: `learning_negative::${negative.length}`,
            });
          }

          // 3. stale memories
          const cutoff = Date.now() - 60 * 86_400_000;
          const stale = memories.filter(
            (m) =>
              m.is_active &&
              m.confidence < 0.6 &&
              new Date(m.last_observed_at).getTime() < cutoff,
          );
          if (stale.length >= 5) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "learning_loop_stale_memories",
              affected_layer: "system",
              title: `${stale.length} застарілих ai_memory-правил (>60 днів, low confidence)`,
              description: `Ці правила більше не оновлюються та мають низьку впевненість — імовірно, патерн змінився або зник.`,
              expected_impact:
                "Запусти переоцінку ai_memory або деактивуй stale-правила, щоб ШІ не спирався на застарілі сигнали.",
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                count: stale.length,
                suggested_action: "reevaluate_or_archive",
              },
              dedup_key: `learning_stale::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            memories_total: memories.length,
            silent_agents: agentsWithoutMemory.length,
            negative: negative.length,
            stale: stale.length,
          });
          return jsonOk({
            run_id: handle.runId,
            memories_total: memories.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Learning loop monitor failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
