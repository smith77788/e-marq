/**
 * Detector — agent that fails 5+ times consecutively → kill-switch candidate.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DetectorFn } from "../types";

export const detectAgentRunsFailing: DetectorFn = async ({ tenantId }) => {
  if (!tenantId) return [];
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: runs } = await supabaseAdmin
    .from("acos_agent_runs")
    .select("agent_key, status, started_at")
    .eq("tenant_id", tenantId)
    .gte("started_at", since24h)
    .order("started_at", { ascending: false })
    .limit(500);
  if (!runs || runs.length === 0) return [];

  const byAgent = new Map<string, { fail: number; total: number }>();
  for (const r of runs) {
    const cur = byAgent.get(r.agent_key) ?? { fail: 0, total: 0 };
    cur.total++;
    if (r.status === "failed") cur.fail++;
    byAgent.set(r.agent_key, cur);
  }

  const offenders = [...byAgent.entries()].filter(
    ([, v]) => v.fail >= 5 && v.fail / v.total >= 0.8,
  );

  return offenders.map(([agentKey, v]) => ({
    detector: "agent_runs_failing",
    tenant_id: tenantId,
    severity: "p1" as const,
    title: `Agent "${agentKey}" failing ${v.fail}/${v.total} (24h)`,
    root_cause: `Agent has ≥5 failures with >80% fail rate in 24h. Kill-switch recommended.`,
    scope: { tenant_id: tenantId, agent_key: agentKey, fail: v.fail, total: v.total },
    fingerprint: `agent_failing:${tenantId}:${agentKey}`,
    regression_risk: "medium",
    proposed_actions: [
      {
        kind: "kill_failing_agent",
        payload: { tenant_id: tenantId, agent_key: agentKey },
        reversible: true,
        revert_payload: { tenant_id: tenantId, agent_key: agentKey, restore_enabled: true },
      },
    ],
  }));
};
