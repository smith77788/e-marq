/**
 * Action executors — apply / revert each whitelisted action kind.
 * Each function MUST be idempotent and safe to retry.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ActionKind } from "./types";

export type ExecResult = { ok: boolean; message: string; affected: number };

type AnyPayload = Record<string, unknown>;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ─── APPLY ──────────────────────────────────────────────────────────────────
export async function applyAction(kind: ActionKind, payload: AnyPayload): Promise<ExecResult> {
  switch (kind) {
    case "reschedule_outreach": {
      const ids = asArray<string>(payload.action_ids);
      if (ids.length === 0) return { ok: true, message: "no ids", affected: 0 };
      const next = new Date(Date.now() + 15 * 60_000).toISOString();
      const { error } = await supabaseAdmin
        .from("outreach_actions")
        .update({ status: "pending_review", scheduled_for: next } as never)
        .in("id", ids);
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Rescheduled ${ids.length} actions`, affected: ids.length };
    }

    case "reset_stuck_agent_run": {
      const ids = asArray<string>(payload.run_ids);
      if (ids.length === 0) return { ok: true, message: "no ids", affected: 0 };
      const { error } = await supabaseAdmin
        .from("acos_agent_runs")
        .update({
          status: "failed",
          error: "auto-reset by self-heal (stuck >30min)",
          finished_at: new Date().toISOString(),
        } as never)
        .in("id", ids);
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Reset ${ids.length} stuck runs`, affected: ids.length };
    }

    case "kill_failing_agent": {
      const tenantId = asString(payload.tenant_id);
      const agentId = asString(payload.agent_id);
      if (!tenantId || !agentId) return { ok: false, message: "missing ids", affected: 0 };
      const { error } = await supabaseAdmin.from("agent_permissions").upsert(
        {
          tenant_id: tenantId,
          agent_id: agentId,
          mode: "off" as never,
        } as never,
        { onConflict: "tenant_id,agent_id" },
      );
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Killed agent ${agentId}`, affected: 1 };
    }

    case "cleanup_expired_notifications": {
      const tenantId = asString(payload.tenant_id);
      const cutoff = asString(payload.older_than_iso);
      if (!tenantId || !cutoff) return { ok: false, message: "missing args", affected: 0 };
      const { error, count } = await supabaseAdmin
        .from("owner_notifications")
        .delete({ count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("is_read", false)
        .lt("created_at", cutoff);
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Deleted ${count ?? 0} stale notifs`, affected: count ?? 0 };
    }

    case "pause_unhealthy_channel": {
      const tenantId = asString(payload.tenant_id);
      const channel = asString(payload.channel);
      if (!tenantId || !channel) return { ok: false, message: "missing args", affected: 0 };
      const settingKey = `${channel}_posting_enabled`;
      const { error } = await supabaseAdmin.from("outreach_settings").upsert(
        {
          tenant_id: tenantId,
          key: settingKey,
          value: false as never,
          description: "Auto-paused by self-heal",
        } as never,
        { onConflict: "tenant_id,key" },
      );
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Paused ${channel}`, affected: 1 };
    }

    case "flag_stuck_order":
    case "notify_balance_low":
    case "rerun_dntrade_sync":
      return { ok: true, message: "noop (manual action)", affected: 0 };

    default:
      return { ok: false, message: `unknown kind: ${String(kind)}`, affected: 0 };
  }
}

// ─── REVERT ─────────────────────────────────────────────────────────────────
export async function revertAction(
  kind: ActionKind,
  revert: AnyPayload,
): Promise<ExecResult> {
  switch (kind) {
    case "reschedule_outreach": {
      const ids = asArray<string>(revert.action_ids);
      const restore = asString(revert.restore_status) ?? "failed";
      if (ids.length === 0) return { ok: true, message: "no ids", affected: 0 };
      const { error } = await supabaseAdmin
        .from("outreach_actions")
        .update({ status: restore } as never)
        .in("id", ids);
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Reverted ${ids.length}`, affected: ids.length };
    }
    case "kill_failing_agent": {
      const tenantId = asString(revert.tenant_id);
      const agentId = asString(revert.agent_id);
      if (!tenantId || !agentId) return { ok: false, message: "missing ids", affected: 0 };
      const { error } = await supabaseAdmin.from("agent_permissions").upsert(
        { tenant_id: tenantId, agent_id: agentId, mode: "auto" as never } as never,
        { onConflict: "tenant_id,agent_id" },
      );
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Re-enabled ${agentId}`, affected: 1 };
    }
    case "pause_unhealthy_channel": {
      const tenantId = asString(revert.tenant_id);
      const channel = asString(revert.channel);
      if (!tenantId || !channel) return { ok: false, message: "missing args", affected: 0 };
      const settingKey = `${channel}_posting_enabled`;
      const { error } = await supabaseAdmin.from("outreach_settings").upsert(
        {
          tenant_id: tenantId,
          key: settingKey,
          value: true as never,
          description: "Re-enabled by self-heal revert",
        } as never,
        { onConflict: "tenant_id,key" },
      );
      if (error) return { ok: false, message: error.message, affected: 0 };
      return { ok: true, message: `Re-enabled ${channel}`, affected: 1 };
    }
    default:
      return { ok: false, message: "not reversible", affected: 0 };
  }
}
