/**
 * Meta Prior Injector — бере найкращі decision_policies (висока win-rate
 * за >30 trials) та апсертить їх як ai_memory-правила, щоб ШІ-агенти могли
 * брати їх як priors на нових тенантах/SKU.
 *
 * Це механізм "transfer learning" в межах одного tenant: кращі policies
 * стають "загальним знанням".
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

const AGENT_ID = "meta-prior-injector";

export const Route = createFileRoute("/hooks/agents/meta-prior-injector")({
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
            .from("decision_policies")
            .select(
              "policy_key, value, trial_count, win_count, total_revenue_cents, is_active, reason",
            )
            .eq("tenant_id", tenantId)
            .gte("trial_count", 30)
            .eq("is_active", true)
            .limit(500);
          if (error) throw error;
          const policies = data ?? [];
          if (policies.length === 0) {
            await finishAgentRun(handle, 0, { reason: "no_mature_policies" });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          const winners = policies.filter((p) => {
            const winRate = p.win_count / Math.max(p.trial_count, 1);
            return winRate >= 0.6;
          });

          if (winners.length === 0) {
            await finishAgentRun(handle, 0, {
              policies_scanned: policies.length,
              winners: 0,
            });
            return jsonOk({ run_id: handle.runId, insights_created: 0 });
          }

          // Upsert each winner as ai_memory pattern (as a positive prior).
          let upserts = 0;
          for (const p of winners) {
            const winRate = p.win_count / Math.max(p.trial_count, 1);
            // Derive agent name from policy_key like "engine.reorder.performance" or "agent.price-optimizer.foo"
            const parts = p.policy_key.split(".");
            const agent = parts[1] ?? "system";
            const patternKey = `policy_prior::${p.policy_key}`;

            const existing = await supabaseAdmin
              .from("ai_memory")
              .select("id, success_count, failure_count")
              .eq("tenant_id", tenantId)
              .eq("agent", agent)
              .eq("pattern_key", patternKey)
              .maybeSingle();

            const rule = `Use policy "${p.policy_key}" as default (win-rate ${(winRate * 100).toFixed(0)}% on ${p.trial_count} trials).`;
            if (existing.data) {
              const { error: upErr } = await supabaseAdmin
                .from("ai_memory")
                .update({
                  success_count: p.win_count,
                  failure_count: Math.max(p.trial_count - p.win_count, 0),
                  confidence: Math.min(0.5 + winRate * 0.5, 0.95),
                  learned_rule: rule,
                  evidence: {
                    source: "decision_policies",
                    policy_key: p.policy_key,
                    trial_count: p.trial_count,
                    win_count: p.win_count,
                    total_revenue_cents: p.total_revenue_cents,
                    value: p.value,
                  },
                  is_active: true,
                  last_observed_at: new Date().toISOString(),
                  avg_impact: p.total_revenue_cents / Math.max(p.win_count, 1),
                })
                .eq("id", existing.data.id);
              if (upErr) throw upErr;
              upserts++;
            } else {
              const { error: insErr } = await supabaseAdmin.from("ai_memory").insert({
                tenant_id: tenantId,
                agent,
                pattern_key: patternKey,
                category: "policy_prior",
                success_count: p.win_count,
                failure_count: Math.max(p.trial_count - p.win_count, 0),
                confidence: Math.min(0.5 + winRate * 0.5, 0.95),
                learned_rule: rule,
                evidence: {
                  source: "decision_policies",
                  policy_key: p.policy_key,
                  trial_count: p.trial_count,
                  win_count: p.win_count,
                  total_revenue_cents: p.total_revenue_cents,
                  value: p.value,
                },
                is_active: true,
                avg_impact: p.total_revenue_cents / Math.max(p.win_count, 1),
              });
              if (insErr) throw insErr;
              upserts++;
            }
          }

          const insights: AgentInsightInput[] = [];
          if (upserts >= 3) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "meta_priors_injected",
              affected_layer: "system",
              title: `${upserts} перевірених policies стали priors для агентів`,
              description: `Найкращі decision_policies (win-rate ≥60% на ≥30 trials) тепер служать стартовою точкою для інших агентів.`,
              expected_impact:
                "Агенти швидше досягають оптимуму на нових SKU/сегментах — менше дорогих 'exploration' помилок.",
              confidence: 0.85,
              risk_level: "low",
              metrics: {
                upserts,
                policies_scanned: policies.length,
                suggested_action: "review_priors",
              },
              dedup_key: `meta_priors::${new Date().toISOString().slice(0, 7)}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            policies_scanned: policies.length,
            winners: winners.length,
            upserts,
          });
          return jsonOk({
            run_id: handle.runId,
            policies_scanned: policies.length,
            upserts,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Meta prior injector failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
