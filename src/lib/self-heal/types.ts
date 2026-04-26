/**
 * Self-Healing Engine — shared types.
 */

export type Severity = "p0" | "p1" | "p2" | "p3";
export type RegressionRisk = "low" | "medium" | "high";
export type Decision = "apply" | "propose" | "block" | "monitor";

export type IncidentDraft = {
  detector: string;
  tenant_id: string | null;
  severity: Severity;
  title: string;
  root_cause: string;
  scope: Record<string, unknown>;
  /** Stable key (detector + meaningful scope) so we can dedupe. */
  fingerprint: string;
  regression_risk: RegressionRisk;
  /** Suggested action(s) to attach to this incident. */
  proposed_actions: ActionDraft[];
};

export type ActionKind =
  | "reschedule_outreach"
  | "reset_stuck_agent_run"
  | "kill_failing_agent"
  | "cleanup_expired_notifications"
  | "pause_unhealthy_channel"
  | "flag_stuck_order"
  | "notify_balance_low"
  | "rerun_dntrade_sync";

export type ActionDraft = {
  kind: ActionKind;
  payload: Record<string, unknown>;
  reversible: boolean;
  /** Optional payload used to revert (e.g. previous values). */
  revert_payload?: Record<string, unknown> | null;
};

export type DetectorResult = IncidentDraft[];

export type DetectorFn = (ctx: { tenantId: string | null }) => Promise<DetectorResult>;

/** Whitelisted kinds that auto-apply (others stay as PROPOSE). */
export const WHITELIST_AUTO_APPLY: ActionKind[] = [
  "reschedule_outreach",
  "reset_stuck_agent_run",
  "kill_failing_agent",
  "cleanup_expired_notifications",
  "pause_unhealthy_channel",
];
