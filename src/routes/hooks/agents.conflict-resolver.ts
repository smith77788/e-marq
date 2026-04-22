/**
 * Conflict Resolver — детектить ai_actions, що конкурують за один target
 * (наприклад, два pricing-агенти запропонували різні ціни на той самий продукт
 * у вікні 24 год). Записує в `agent_conflicts` і створює insight про необхідність
 * pick-a-winner.
 *
 * Стратегія: якщо ≥2 pending/applied actions з однаковим (target_entity, target_id)
 * від різних agent_id за останні 24 год — це конфлікт.
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

const AGENT_ID = "conflict-resolver";

export const Route = createFileRoute("/hooks/agents/conflict-resolver")({
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
          const since = new Date(Date.now() - 24 * 3600_000).toISOString();
          const [actionsRes, existingRes] = await Promise.all([
            supabaseAdmin
              .from("ai_actions")
              .select(
                "id, agent_id, action_type, target_entity, target_id, status, parameters, created_at",
              )
              .eq("tenant_id", tenantId)
              .gte("created_at", since)
              .in("status", ["pending", "applied"])
              .not("target_entity", "is", null)
              .not("target_id", "is", null)
              .limit(2000),
            supabaseAdmin
              .from("agent_conflicts")
              .select("conflicting_action_ids")
              .eq("tenant_id", tenantId)
              .eq("resolution", "pending"),
          ]);

          const actions = actionsRes.data ?? [];
          const alreadyConflicted = new Set<string>();
          for (const c of existingRes.data ?? []) {
            for (const id of c.conflicting_action_ids ?? []) alreadyConflicted.add(id);
          }

          // Group by (target_entity, target_id)
          const groups = new Map<string, typeof actions>();
          for (const a of actions) {
            if (!a.target_entity || !a.target_id) continue;
            const k = `${a.target_entity}::${a.target_id}`;
            const arr = groups.get(k) ?? [];
            arr.push(a);
            groups.set(k, arr);
          }

          const conflicts: Array<{
            tenant_id: string;
            conflict_type: string;
            conflicting_action_ids: string[];
            reason: string;
          }> = [];
          const insights: AgentInsightInput[] = [];

          for (const [key, arr] of groups) {
            if (arr.length < 2) continue;
            const distinctAgents = new Set(arr.map((a) => a.agent_id));
            if (distinctAgents.size < 2) continue;
            // Skip if any of these are already in a pending conflict
            if (arr.every((a) => alreadyConflicted.has(a.id))) continue;

            const ids = arr.map((a) => a.id);
            const agentList = Array.from(distinctAgents).join(", ");
            const [entity, targetId] = key.split("::");

            conflicts.push({
              tenant_id: tenantId,
              conflict_type: `${entity}_multi_agent`,
              conflicting_action_ids: ids,
              reason: `${distinctAgents.size} agents (${agentList}) targeted ${entity} ${targetId.slice(0, 8)} within 24h.`,
            });

            insights.push({
              tenant_id: tenantId,
              insight_type: "agent_conflict_detected",
              affected_layer: "system",
              title: `Конфлікт: ${distinctAgents.size} агенти на ${entity} ${targetId.slice(0, 8)}`,
              description: `${agentList} одночасно діють на той самий ${entity}. Без pick-a-winner результати спотворяться.`,
              expected_impact:
                "Виберіть outcome-кращий агент для цього target або об'єднайте дії — інакше ROI вимірювання буде шумним.",
              confidence: 0.85,
              risk_level: distinctAgents.size >= 3 ? "high" : "medium",
              metrics: {
                target_entity: entity,
                target_id: targetId,
                agents: Array.from(distinctAgents),
                action_ids: ids,
                action_types: Array.from(new Set(arr.map((a) => a.action_type))),
                suggested_action: "manual_pick_winner",
              },
              dedup_key: `conflict::${key}`,
            });
          }

          if (conflicts.length > 0) {
            for (let i = 0; i < conflicts.length; i += 100) {
              const chunk = conflicts.slice(i, i + 100);
              const { error } = await supabaseAdmin.from("agent_conflicts").insert(chunk);
              if (error) throw error;
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            actions_scanned: actions.length,
            conflicts_found: conflicts.length,
          });
          return jsonOk({
            run_id: handle.runId,
            conflicts_found: conflicts.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Conflict resolver failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
