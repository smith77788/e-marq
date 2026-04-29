/**
 * Self-Heal Engine — orchestrates detectors, dedupe, decision, and apply.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectOutreachFailures } from "./detectors/outreachFailures";
import { detectAgentRunsStuck } from "./detectors/agentRunsStuck";
import { detectAgentRunsFailing } from "./detectors/agentRunsFailing";
import { detectStaleNotifications } from "./detectors/staleNotifications";
import { detectOrdersStuck } from "./detectors/ordersStuck";
import { applyAction, revertAction, type ExecResult } from "./actions";
import {
  WHITELIST_AUTO_APPLY,
  type ActionDraft,
  type ActionKind,
  type Decision,
  type IncidentDraft,
  type Severity,
} from "./types";

const DETECTORS = [
  { name: "outreach_failures", fn: detectOutreachFailures },
  { name: "agent_runs_stuck", fn: detectAgentRunsStuck },
  { name: "agent_runs_failing", fn: detectAgentRunsFailing },
  { name: "stale_notifications", fn: detectStaleNotifications },
  { name: "orders_stuck", fn: detectOrdersStuck },
];

const SEVERITY_RANK: Record<Severity, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

async function loadSettings() {
  const { data } = await supabaseAdmin.from("self_heal_settings").select("key, value");
  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key, row.value);
  return {
    autoEnabled: (map.get("auto_heal_enabled") as boolean) ?? true,
    allowedKinds: new Set(
      ((map.get("allowed_kinds") as string[]) ?? WHITELIST_AUTO_APPLY) as ActionKind[],
    ),
    severityThreshold:
      ((map.get("severity_threshold") as Severity) ?? "p2") as Severity,
    dedupeWindowMin:
      typeof map.get("dedupe_window_minutes") === "number"
        ? (map.get("dedupe_window_minutes") as number)
        : 60,
  };
}

function decide(
  draft: IncidentDraft,
  action: ActionDraft,
  settings: Awaited<ReturnType<typeof loadSettings>>,
): Decision {
  if (draft.regression_risk === "high") return "block";
  if (!settings.autoEnabled) return "propose";
  if (!settings.allowedKinds.has(action.kind)) return "propose";
  if (SEVERITY_RANK[draft.severity] > SEVERITY_RANK[settings.severityThreshold]) return "monitor";
  return "apply";
}

export type CycleSummary = {
  detectors_run: number;
  incidents_created: number;
  incidents_updated: number;
  actions_applied: number;
  actions_proposed: number;
  actions_blocked: number;
  errors: { detector: string; error: string }[];
};

export async function runSelfHealCycle(tenantId: string | null = null): Promise<CycleSummary> {
  const settings = await loadSettings();
  const summary: CycleSummary = {
    detectors_run: 0,
    incidents_created: 0,
    incidents_updated: 0,
    actions_applied: 0,
    actions_proposed: 0,
    actions_blocked: 0,
    errors: [],
  };

  // If specific tenant — just that one. Else iterate active tenants.
  const tenantIds: (string | null)[] = tenantId
    ? [tenantId]
    : await loadActiveTenantIds();
  // Add a `null` pass for system-wide detectors that ignore tenant scoping.
  if (!tenantId && !tenantIds.includes(null)) tenantIds.push(null);

  for (const tId of tenantIds) {
    for (const det of DETECTORS) {
      summary.detectors_run++;
      let drafts: IncidentDraft[] = [];
      try {
        drafts = await det.fn({ tenantId: tId });
      } catch (err) {
        summary.errors.push({
          detector: det.name,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const draft of drafts) {
        const incident = await upsertIncident(draft);
        if (!incident) continue;
        if (incident.created) summary.incidents_created++;
        else summary.incidents_updated++;

        for (const action of draft.proposed_actions) {
          const decision = decide(draft, action, settings);

          // Dedupe non-apply decisions: skip persisting a fresh row when an
          // identical (incident, kind, decision) entry was created in the last
          // 24h. Without this, long-lived high-risk incidents (e.g. orders_stuck
          // → block) flood the inbox with a new BLOCK row every 5 minutes.
          if (decision !== "apply") {
            const { data: existingAction } = await supabaseAdmin
              .from("self_heal_actions")
              .select("id, decision, status, created_at")
              .eq("incident_id", incident.id)
              .eq("kind", action.kind)
              .in("status", ["skipped", "pending"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (
              existingAction &&
              existingAction.decision === decision &&
              Date.now() - new Date(existingAction.created_at).getTime() <
                24 * 3600_000
            ) {
              if (decision === "propose") summary.actions_proposed++;
              else if (decision === "block") summary.actions_blocked++;
              continue;
            }
          }

          const { actionId, applied } = await persistAction(
            incident.id,
            action,
            decision,
          );

          if (decision === "apply" && actionId) {
            const res = await safeApply(action.kind, action.payload);
            await markActionResult(actionId, res);
            if (res.ok) {
              summary.actions_applied++;
              await markIncidentFixed(incident.id);
            } else {
              summary.actions_blocked++;
            }
          } else if (decision === "propose") {
            summary.actions_proposed++;
          } else if (decision === "block") {
            summary.actions_blocked++;
          }
          // monitor → just logged, no exec
          void applied;
        }
      }
    }
  }

  return summary;
}

async function loadActiveTenantIds(): Promise<(string | null)[]> {
  const { data } = await supabaseAdmin.from("tenants").select("id").eq("status", "active").limit(100);
  return (data ?? []).map((t) => t.id as string);
}

async function upsertIncident(
  draft: IncidentDraft,
): Promise<{ id: string; created: boolean } | null> {
  // Try find existing open incident by fingerprint.
  const { data: existing } = await supabaseAdmin
    .from("self_heal_incidents")
    .select("id, occurrences")
    .eq("fingerprint", draft.fingerprint)
    .in("status", ["open", "fixing", "monitoring"])
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("self_heal_incidents")
      .update({
        occurrences: (existing.occurrences ?? 1) + 1,
        last_seen_at: new Date().toISOString(),
        // refresh title/severity/scope to most recent
        title: draft.title,
        severity: draft.severity,
        scope_json: draft.scope as never,
        root_cause: draft.root_cause,
      } as never)
      .eq("id", existing.id);
    return { id: existing.id, created: false };
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("self_heal_incidents")
    .insert({
      detector: draft.detector,
      tenant_id: draft.tenant_id,
      severity: draft.severity,
      title: draft.title,
      root_cause: draft.root_cause,
      scope_json: draft.scope as never,
      fingerprint: draft.fingerprint,
      regression_risk: draft.regression_risk,
      // inc_code auto-assigned by trigger
      inc_code: "",
    } as never)
    .select("id")
    .single();
  if (error || !inserted) return null;
  return { id: inserted.id, created: true };
}

async function persistAction(
  incidentId: string,
  action: ActionDraft,
  decision: Decision,
): Promise<{ actionId: string | null; applied: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("self_heal_actions")
    .insert({
      incident_id: incidentId,
      kind: action.kind,
      decision,
      payload_json: action.payload as never,
      revert_payload: (action.revert_payload ?? null) as never,
      reversible: action.reversible,
      status: decision === "apply" ? "pending" : "skipped",
    } as never)
    .select("id")
    .single();
  if (error || !data) return { actionId: null, applied: false };
  return { actionId: data.id, applied: false };
}

async function safeApply(kind: ActionKind, payload: Record<string, unknown>): Promise<ExecResult> {
  try {
    return await applyAction(kind, payload);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      affected: 0,
    };
  }
}

async function markActionResult(actionId: string, res: ExecResult) {
  await supabaseAdmin
    .from("self_heal_actions")
    .update({
      status: res.ok ? "applied" : "failed",
      applied_at: new Date().toISOString(),
      result_text: res.message,
    } as never)
    .eq("id", actionId);
}

async function markIncidentFixed(incidentId: string) {
  await supabaseAdmin
    .from("self_heal_incidents")
    .update({
      status: "fixed",
      resolved_at: new Date().toISOString(),
    } as never)
    .eq("id", incidentId);
}

// ─── PROPOSAL APPLY (called by user via /apply endpoint) ────────────────────
export async function applyProposal(
  actionId: string,
  userId: string,
): Promise<ExecResult> {
  const { data: action } = await supabaseAdmin
    .from("self_heal_actions")
    .select("id, kind, payload_json, status, incident_id")
    .eq("id", actionId)
    .single();
  if (!action) return { ok: false, message: "action not found", affected: 0 };
  if (action.status === "applied") {
    return { ok: false, message: "already applied", affected: 0 };
  }
  const res = await safeApply(action.kind as ActionKind, (action.payload_json ?? {}) as Record<string, unknown>);
  await supabaseAdmin
    .from("self_heal_actions")
    .update({
      status: res.ok ? "applied" : "failed",
      applied_at: new Date().toISOString(),
      applied_by: userId,
      result_text: res.message,
    } as never)
    .eq("id", actionId);
  if (res.ok && action.incident_id) await markIncidentFixed(action.incident_id);
  return res;
}

export async function revertAppliedAction(
  actionId: string,
  userId: string,
): Promise<ExecResult> {
  const { data: action } = await supabaseAdmin
    .from("self_heal_actions")
    .select("id, kind, revert_payload, reversible, status")
    .eq("id", actionId)
    .single();
  if (!action) return { ok: false, message: "action not found", affected: 0 };
  if (!action.reversible) return { ok: false, message: "not reversible", affected: 0 };
  if (action.status !== "applied") {
    return { ok: false, message: "only applied actions can be reverted", affected: 0 };
  }
  const res = await revertAction(
    action.kind as ActionKind,
    (action.revert_payload ?? {}) as Record<string, unknown>,
  );
  await supabaseAdmin
    .from("self_heal_actions")
    .update({
      status: res.ok ? "reverted" : "failed",
      reverted_at: new Date().toISOString(),
      reverted_by: userId,
      result_text: `revert: ${res.message}`,
    } as never)
    .eq("id", actionId);
  return res;
}
