/**
 * POST /hooks/agents/tg-user-action-executor
 * Виконавець черги tg_user_actions з квотами та human-like затримкою.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import {
  executeAction,
  isBridgeConfigured,
  type BridgeAction,
} from "@/lib/telegram/mtprotoBridge";

const AGENT_ID = "tg-user-action-executor";
const DEFAULT_BATCH = 25;

type ActionRow = {
  id: string;
  tenant_id: string;
  action_type: string;
  payload: Record<string, unknown>;
  target: Record<string, unknown>;
  scheduled_for: string | null;
};

type QuotaRow = {
  delay_min_seconds: number;
  delay_max_seconds: number;
  max_dm_per_day: number;
  max_dm_per_hour: number;
  max_comment_per_day: number;
  max_comment_per_hour: number;
  max_reaction_per_day: number;
  max_reaction_per_hour: number;
  max_join_per_day: number;
  agent_max_per_day: number;
  agent_autonomy_enabled: boolean;
  paused_until: string | null;
};

type Limits = { perHour: number; perDay: number };

function limitsFor(quota: QuotaRow, actionType: string): Limits {
  switch (actionType) {
    case "send_dm":
      return { perHour: quota.max_dm_per_hour, perDay: quota.max_dm_per_day };
    case "send_comment":
      return { perHour: quota.max_comment_per_hour, perDay: quota.max_comment_per_day };
    case "reaction":
      return { perHour: quota.max_reaction_per_hour, perDay: quota.max_reaction_per_day };
    case "join_channel":
      return { perHour: 999, perDay: quota.max_join_per_day };
    default:
      return { perHour: quota.agent_max_per_day, perDay: quota.agent_max_per_day };
  }
}

const FALLBACK_QUOTA: QuotaRow = {
  delay_min_seconds: 45,
  delay_max_seconds: 180,
  max_dm_per_day: 30,
  max_dm_per_hour: 5,
  max_comment_per_day: 30,
  max_comment_per_hour: 5,
  max_reaction_per_day: 60,
  max_reaction_per_hour: 10,
  max_join_per_day: 5,
  agent_max_per_day: 60,
  agent_autonomy_enabled: true,
  paused_until: null,
};

async function getQuota(tenantId: string): Promise<QuotaRow> {
  const { data } = await supabaseAdmin
    .from("tg_user_quotas")
    .select(
      "delay_min_seconds,delay_max_seconds,max_dm_per_day,max_dm_per_hour,max_comment_per_day,max_comment_per_hour,max_reaction_per_day,max_reaction_per_hour,max_join_per_day,agent_max_per_day,agent_autonomy_enabled,paused_until",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return FALLBACK_QUOTA;
  return data as unknown as QuotaRow;
}

async function countRecent(
  tenantId: string,
  actionType: string,
  windowMinutes: number,
): Promise<number> {
  const { data } = await supabaseAdmin.rpc("tg_user_count_actions", {
    _tenant_id: tenantId,
    _action_type: actionType,
    _window_minutes: windowMinutes,
  });
  return Number(data ?? 0);
}

async function getActiveSessionEnc(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tg_user_sessions")
    .select("encrypted_session,status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { encrypted_session: string | null; status: string };
  if (row.status !== "active") return null;
  return row.encrypted_session ?? null;
}

function buildBridgeAction(row: ActionRow): BridgeAction | null {
  const p = row.payload ?? {};
  const t = row.target ?? {};
  const peer = (t.peer ?? p.peer) as string | number | undefined;
  if (peer === undefined) return null;
  switch (row.action_type) {
    case "send_dm":
      if (typeof p.text !== "string") return null;
      return {
        type: "send_dm",
        peer,
        text: p.text,
        reply_to: typeof p.reply_to === "number" ? p.reply_to : null,
      };
    case "send_comment":
      if (typeof p.message_id !== "number" || typeof p.text !== "string") return null;
      return { type: "send_comment", peer, message_id: p.message_id, text: p.text };
    case "reaction":
      if (typeof p.message_id !== "number" || typeof p.emoji !== "string") return null;
      return {
        type: "reaction",
        peer,
        message_id: p.message_id,
        emoji: p.emoji,
        remove: p.remove === true,
      };
    case "report_chat":
      if (typeof p.reason !== "string" || typeof p.message !== "string") return null;
      return { type: "report_chat", peer, reason: p.reason as never, message: p.message };
    case "report_message":
      if (!Array.isArray(p.message_ids) || typeof p.reason !== "string") return null;
      return {
        type: "report_message",
        peer,
        message_ids: (p.message_ids as unknown[]).map(Number).filter(Number.isFinite),
        reason: p.reason as never,
        message: typeof p.message === "string" ? p.message : "",
      };
    default:
      return null;
  }
}

export const Route = createFileRoute("/hooks/agents/tg-user-action-executor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const dummyTenant = "00000000-0000-0000-0000-000000000000";
        const probe = await authorizeAgentRequest(token, dummyTenant);
        const isCron = "kind" in probe && probe.kind === "cron";
        if (!isCron) {
          const body = (await request
            .clone()
            .json()
            .catch(() => ({}))) as { tenant_id?: string };
          if (!body.tenant_id) return jsonError("missing_tenant", 400);
          const a2 = await authorizeAgentRequest(token, body.tenant_id);
          if ("error" in a2) return jsonError(a2.error, a2.status);
        }

        if (!isBridgeConfigured()) {
          return jsonOk({ skipped: true, reason: "bridge_not_configured" });
        }

        const url = new URL(request.url);
        const limit = Math.min(
          200,
          Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_BATCH),
        );
        const tenantFilter = url.searchParams.get("tenant");

        let q = supabaseAdmin
          .from("tg_user_actions")
          .select("id,tenant_id,action_type,payload,target,scheduled_for")
          .eq("status", "queued")
          .lte("scheduled_for", new Date().toISOString())
          .order("scheduled_for", { ascending: true })
          .limit(limit);
        if (tenantFilter) q = q.eq("tenant_id", tenantFilter);

        const { data: actions, error } = await q;
        if (error) return jsonError(error.message, 500);
        const queue = (actions ?? []) as unknown as ActionRow[];

        let processed = 0;
        let posted = 0;
        let skipped = 0;
        let failed = 0;

        for (const row of queue) {
          const sessionEnc = await getActiveSessionEnc(row.tenant_id);
          if (!sessionEnc) {
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "failed",
                last_error: "no_active_session",
                executed_at: new Date().toISOString(),
              } as never)
              .eq("id", row.id);
            failed += 1;
            continue;
          }

          const quota = await getQuota(row.tenant_id);
          if (
            !quota.agent_autonomy_enabled ||
            (quota.paused_until && new Date(quota.paused_until) > new Date())
          ) {
            const nextAt = quota.paused_until ?? new Date(Date.now() + 30 * 60_000).toISOString();
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "queued",
                scheduled_for: nextAt,
                last_error: "agent_paused",
              } as never)
              .eq("id", row.id);
            skipped += 1;
            continue;
          }

          const limits = limitsFor(quota, row.action_type);
          const [usedDay, usedHour] = await Promise.all([
            countRecent(row.tenant_id, row.action_type, 60 * 24),
            countRecent(row.tenant_id, row.action_type, 60),
          ]);
          if (usedDay >= limits.perDay || usedHour >= limits.perHour) {
            const next = new Date(Date.now() + 30 * 60_000).toISOString();
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "queued",
                scheduled_for: next,
                last_error: `quota: ${usedDay}/${limits.perDay}d, ${usedHour}/${limits.perHour}h`,
              } as never)
              .eq("id", row.id);
            skipped += 1;
            continue;
          }

          const bridgeAction = buildBridgeAction(row);
          if (!bridgeAction) {
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "failed",
                last_error: "invalid_payload",
                executed_at: new Date().toISOString(),
              } as never)
              .eq("id", row.id);
            failed += 1;
            continue;
          }

          await supabaseAdmin
            .from("tg_user_actions")
            .update({ status: "in_progress" } as never)
            .eq("id", row.id);

          const startedAt = Date.now();
          const result = await executeAction({
            tenant_id: row.tenant_id,
            session_enc: sessionEnc,
            action: bridgeAction,
          });
          const durationMs = Date.now() - startedAt;

          if (result.ok) {
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "posted",
                executed_at: new Date().toISOString(),
                result: {
                  posted_url: result.posted_url ?? null,
                  message_id: result.message_id ?? null,
                  meta: result.meta ?? {},
                } as never,
                last_error: null,
              } as never)
              .eq("id", row.id);
            await supabaseAdmin.from("tg_user_action_log").insert({
              tenant_id: row.tenant_id,
              action_id: row.id,
              action_type: row.action_type,
              status: "posted",
              duration_ms: durationMs,
              target: row.target as never,
              result: { posted_url: result.posted_url ?? null } as never,
            } as never);
            await supabaseAdmin
              .from("tg_user_sessions")
              .update({ last_used_at: new Date().toISOString() } as never)
              .eq("tenant_id", row.tenant_id);
            posted += 1;
          } else {
            const isFlood = result.code === "flood_wait";
            const isExpired = result.code === "session_expired";
            const errMsg = `${result.code}: ${result.message}`;
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: isFlood ? "queued" : "failed",
                last_error: errMsg,
                executed_at: new Date().toISOString(),
                scheduled_for: isFlood
                  ? new Date(
                      Date.now() + (result.retry_after_seconds ?? 300) * 1000,
                    ).toISOString()
                  : new Date().toISOString(),
              } as never)
              .eq("id", row.id);
            if (isExpired) {
              await supabaseAdmin
                .from("tg_user_sessions")
                .update({ status: "expired", last_error: errMsg } as never)
                .eq("tenant_id", row.tenant_id);
            }
            await supabaseAdmin.from("tg_user_action_log").insert({
              tenant_id: row.tenant_id,
              action_id: row.id,
              action_type: row.action_type,
              status: isFlood ? "flood" : "failed",
              duration_ms: durationMs,
              target: row.target as never,
              result: { error: result.message } as never,
            } as never);
            failed += 1;
          }

          processed += 1;
          // невелика затримка між діями в межах однієї пачки (cap ~5s)
          const delayMs =
            1000 *
            (quota.delay_min_seconds +
              Math.floor(
                Math.random() * (quota.delay_max_seconds - quota.delay_min_seconds + 1),
              ));
          await new Promise((r) => setTimeout(r, Math.min(delayMs, 5000)));
        }

        return jsonOk({ agent: AGENT_ID, processed, posted, skipped, failed });
      },
    },
  },
});
