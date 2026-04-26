/**
 * Detector — agent runs stuck in `running` state for too long.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DetectorFn } from "../types";

export const detectAgentRunsStuck: DetectorFn = async ({ tenantId }) => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from("acos_agent_runs")
    .select("id, agent_id, tenant_id, started_at")
    .eq("status", "running")
    .lt("started_at", cutoff)
    .limit(100);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data: runs } = await query;
  if (!runs || runs.length === 0) return [];

  const byTenant = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = r.tenant_id ?? "system";
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key)!.push(r);
  }

  return [...byTenant.entries()].map(([tKey, rs]) => ({
    detector: "agent_runs_stuck",
    tenant_id: tKey === "system" ? null : tKey,
    severity: rs.length > 5 ? "p1" : "p2",
    title: `${rs.length} agent runs stuck >30min`,
    root_cause: "Agent run has status=running but no heartbeat for 30+ minutes",
    scope: { count: rs.length, agents: [...new Set(rs.map((r) => r.agent_id))] },
    fingerprint: `agent_runs_stuck:${tKey}`,
    regression_risk: "low",
    proposed_actions: [
      {
        kind: "reset_stuck_agent_run",
        payload: { run_ids: rs.map((r) => r.id) },
        reversible: false,
      },
    ],
  }));
};
