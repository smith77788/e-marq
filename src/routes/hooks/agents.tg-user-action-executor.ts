/**
 * POST /hooks/agents/tg-user-action-executor
 *
 * Обробляє чергу tg_user_actions для всіх тенантів (cron-friendly).
 * - Перевіряє квоти (tg_user_quotas) та human-like затримку
 * - Викликає MTProto bridge через src/lib/telegram/mtprotoBridge
 * - Логує в tg_user_action_log, оновлює статус дії
 *
 * Авторизація: Bearer SUPABASE_PUBLISHABLE_KEY (cron) АБО super_admin/owner JWT.
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
  action_type: BridgeAction["type"];
  payload: Record<string, unknown>;
  scheduled_at: string | null;
};

type Quota = {
  daily_limit: number;
  hourly_limit: number;
  delay_min_seconds: number;
  delay_max_seconds: number;
};

const DEFAULT_QUOTA: Quota = {
  daily_limit: 30,
  hourly_limit: 5,
  delay_min_seconds: 45,
  delay_max_seconds: 180,
};

async function getQuota(tenantId: string, actionType: string): Promise<Quota> {
  const { data } = await supabaseAdmin
    .from("tg_user_quotas")
    .select("daily_limit,hourly_limit,delay_min_seconds,delay_max_seconds")
    .eq("tenant_id", tenantId)
    .eq("action_type", actionType)
    .maybeSingle();
  if (!data) return DEFAULT_QUOTA;
  return {
    daily_limit: (data as Quota).daily_limit ?? DEFAULT_QUOTA.daily_limit,
    hourly_limit: (data as Quota).hourly_limit ?? DEFAULT_QUOTA.hourly_limit,
    delay_min_seconds:
      (data as Quota).delay_min_seconds ?? DEFAULT_QUOTA.delay_min_seconds,
    delay_max_seconds:
      (data as Quota).delay_max_seconds ?? DEFAULT_QUOTA.delay_max_seconds,
  };
}

async function countRecent(
  tenantId: string,
  actionType: string,
  windowSeconds: number,
): Promise<number> {
  const { data } = await supabaseAdmin.rpc("tg_user_count_actions", {
    p_tenant_id: tenantId,
    p_action_type: actionType,
    p_window_seconds: windowSeconds,
  });
  return Number(data ?? 0);
}

async function getActiveSessionEnc(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tg_user_sessions")
    .select("session_enc,status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data || (data as { status: string }).status !== "active") return null;
  return (data as { session_enc: string | null }).session_enc ?? null;
}

function buildBridgeAction(row: ActionRow): BridgeAction | null {
  const p = row.payload ?? {};
  switch (row.action_type) {
    case "send_dm":
      if (typeof p.peer !== "string" && typeof p.peer !== "number") return null;
      if (typeof p.text !== "string") return null;
      return {
        type: "send_dm",
        peer: p.peer as string | number,
        text: p.text,
        reply_to: typeof p.reply_to === "number" ? p.reply_to : null,
      };
    case "send_comment":
      if (typeof p.message_id !== "number" || typeof p.text !== "string") return null;
      return {
        type: "send_comment",
        peer: p.peer as string | number,
        message_id: p.message_id,
        text: p.text,
      };
    case "reaction":
      if (typeof p.message_id !== "number" || typeof p.emoji !== "string") return null;
      return {
        type: "reaction",
        peer: p.peer as string | number,
        message_id: p.message_id,
        emoji: p.emoji,
        remove: p.remove === true,
      };
    case "report_chat":
      if (typeof p.reason !== "string" || typeof p.message !== "string") return null;
      return {
        type: "report_chat",
        peer: p.peer as string | number,
        reason: p.reason as never,
        message: p.message,
      };
    case "report_message":
      if (!Array.isArray(p.message_ids) || typeof p.reason !== "string") return null;
      return {
        type: "report_message",
        peer: p.peer as string | number,
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
        // Без tenant — використаємо anon-cron гілку.
        const auth = await authorizeAgentRequest(token, "00000000-0000-0000-0000-000000000000");
        if ("error" in auth && auth.kind !== "cron") {
          // якщо не cron — потребуємо tenant_id у body
          const body = (await request
            .clone()
            .json()
            .catch(() => ({}))) as { tenant_id?: string };
          if (!body.tenant_id) return jsonError("missing_tenant", 400);
          const a2 = await authorizeAgentRequest(token, body.tenant_id);
          if ("error" in a2) return jsonError(a2.error, a2.status);
        }

        if (!isBridgeConfigured()) {
          return jsonOk({
            skipped: true,
            reason: "bridge_not_configured",
          });
        }

        const url = new URL(request.url);
        const limit = Math.min(
          200,
          Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_BATCH),
        );
        const tenantFilter = url.searchParams.get("tenant");

        let q = supabaseAdmin
          .from("tg_user_actions")
          .select("id,tenant_id,action_type,payload,scheduled_at")
          .eq("status", "queued")
          .lte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(limit);
        if (tenantFilter) q = q.eq("tenant_id", tenantFilter);

        const { data: actions, error } = await q;
        if (error) return jsonError(error.message, 500);
        const queue = (actions ?? []) as ActionRow[];

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
                error: "no_active_session",
                attempted_at: new Date().toISOString(),
              } as never)
              .eq("id", row.id);
            failed += 1;
            continue;
          }

          const quota = await getQuota(row.tenant_id, row.action_type);
          const [usedDay, usedHour] = await Promise.all([
            countRecent(row.tenant_id, row.action_type, 86400),
            countRecent(row.tenant_id, row.action_type, 3600),
          ]);
          if (usedDay >= quota.daily_limit || usedHour >= quota.hourly_limit) {
            const delayMin = 30 * 60;
            const next = new Date(Date.now() + delayMin * 1000).toISOString();
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "queued",
                scheduled_at: next,
                error: `quota: ${usedDay}/${quota.daily_limit}d, ${usedHour}/${quota.hourly_limit}h`,
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
                error: "invalid_payload",
                attempted_at: new Date().toISOString(),
              } as never)
              .eq("id", row.id);
            failed += 1;
            continue;
          }

          await supabaseAdmin
            .from("tg_user_actions")
            .update({
              status: "in_progress",
              attempted_at: new Date().toISOString(),
            } as never)
            .eq("id", row.id);

          const result = await executeAction({
            tenant_id: row.tenant_id,
            session_enc: sessionEnc,
            action: bridgeAction,
          });

          if (result.ok) {
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: "posted",
                posted_at: new Date().toISOString(),
                posted_url: result.posted_url ?? null,
                response: (result.meta ?? {}) as never,
                error: null,
              } as never)
              .eq("id", row.id);
            await supabaseAdmin.from("tg_user_action_log").insert({
              tenant_id: row.tenant_id,
              action_id: row.id,
              action_type: row.action_type,
              outcome: "posted",
            } as never);
            await supabaseAdmin
              .from("tg_user_sessions")
              .update({ last_used_at: new Date().toISOString() } as never)
              .eq("tenant_id", row.tenant_id);
            posted += 1;
          } else {
            const isFlood = result.code === "flood_wait";
            const isExpired = result.code === "session_expired";
            await supabaseAdmin
              .from("tg_user_actions")
              .update({
                status: isFlood ? "queued" : "failed",
                error: `${result.code}: ${result.message}`,
                scheduled_at: isFlood
                  ? new Date(
                      Date.now() + (result.retry_after_seconds ?? 300) * 1000,
                    ).toISOString()
                  : null,
              } as never)
              .eq("id", row.id);
            if (isExpired) {
              await supabaseAdmin
                .from("tg_user_sessions")
                .update({ status: "expired" } as never)
                .eq("tenant_id", row.tenant_id);
            }
            await supabaseAdmin.from("tg_user_action_log").insert({
              tenant_id: row.tenant_id,
              action_id: row.id,
              action_type: row.action_type,
              outcome: isFlood ? "flood" : "failed",
              error: result.message,
            } as never);
            failed += 1;
          }

          processed += 1;
          // Human-like delay between consecutive actions of the same tenant.
          const delayMs =
            1000 *
            (quota.delay_min_seconds +
              Math.floor(Math.random() * (quota.delay_max_seconds - quota.delay_min_seconds + 1)));
          await new Promise((r) => setTimeout(r, Math.min(delayMs, 5000)));
        }

        return jsonOk({ agent: AGENT_ID, processed, posted, skipped, failed });
      },
    },
  },
});
