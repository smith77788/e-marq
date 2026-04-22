/**
 * Outreach Action Executor — публікує approved-draft.
 *
 * Stage 1: Reddit постимо лише з OAuth-ключами, telegram — через connector gateway.
 * Інші канали → status="approved" (готовий до ручної публікації).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeOutreach } from "@/lib/outreach/auth";
import {
  getSettings,
  checkDailyRateLimit,
  type OutreachChannel,
} from "@/lib/outreach/shared";

const REDDIT = {
  client_id: process.env.REDDIT_CLIENT_ID,
  client_secret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
  user_agent: process.env.REDDIT_USER_AGENT ?? "marq-outreach/1.0",
};
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;

let _redditToken: { access: string; exp: number } | null = null;

async function redditOauthToken(): Promise<string | null> {
  if (!REDDIT.client_id || !REDDIT.client_secret || !REDDIT.username || !REDDIT.password) return null;
  if (_redditToken && Date.now() < _redditToken.exp - 30_000) return _redditToken.access;
  const basic = btoa(`${REDDIT.client_id}:${REDDIT.client_secret}`);
  const body = new URLSearchParams({
    grant_type: "password",
    username: REDDIT.username,
    password: REDDIT.password,
  });
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "User-Agent": REDDIT.user_agent,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  _redditToken = { access: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _redditToken.access;
}

async function redditPostComment(parentFullname: string, text: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const token = await redditOauthToken();
  if (!token) return { ok: false, error: "no_credentials" };
  const body = new URLSearchParams({ api_type: "json", thing_id: parentFullname, text });
  const res = await fetch("https://oauth.reddit.com/api/comment", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": REDDIT.user_agent,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as { json?: { errors?: unknown[]; data?: { things?: Array<{ data?: { permalink?: string } }> } } };
  if (!res.ok) return { ok: false, error: `${res.status}: ${JSON.stringify(j).slice(0, 200)}` };
  const errors = j?.json?.errors ?? [];
  if (errors.length) return { ok: false, error: JSON.stringify(errors) };
  const permalink = j?.json?.data?.things?.[0]?.data?.permalink;
  return { ok: true, url: permalink ? `https://www.reddit.com${permalink}` : undefined };
}

async function telegramSendMessage(chatId: number, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!LOVABLE_API_KEY) return { ok: false, error: "missing_lovable_api_key" };
  if (!TELEGRAM_API_KEY) return { ok: false, error: "missing_telegram_api_key" };
  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: `telegram_send_failed_${res.status}: ${JSON.stringify(payload).slice(0, 300)}` };
  return { ok: true };
}

export const Route = createFileRoute("/hooks/agents/outreach-action-executor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.clone().json().catch(() => ({}))) as {
          tenant_id?: string; action_id?: string; use_alt?: boolean;
        };
        const auth = await authorizeOutreach(request, body.tenant_id ?? null);
        if ("error" in auth) return jsonError(auth.error, auth.status);

        const action_id = body.action_id;
        if (!action_id) return jsonError("no_action_id", 400);

        const { data: action, error: aErr } = await supabaseAdmin
          .from("outreach_actions")
          .select("id, tenant_id, channel, action_type, draft_text, draft_alt_text, status, lead_id, promo_code")
          .eq("id", action_id)
          .single();
        if (aErr || !action) return jsonError("action_not_found", 404);

        const tenantId = action.tenant_id;
        const { data: lead } = await supabaseAdmin
          .from("outreach_leads")
          .select("source_url, source_platform_id, channel, raw_payload")
          .eq("id", action.lead_id)
          .single();

        const settings = await getSettings(tenantId);
        const channel = action.channel as OutreachChannel;
        const limit = settings.rate_limits?.[channel] ?? 5;
        const rl = await checkDailyRateLimit(tenantId, channel, limit);
        if (!rl.allowed) {
          await supabaseAdmin.from("outreach_actions").update({
            status: "skipped",
            failed_reason: `rate_limit_${channel}: used ${rl.used}/${rl.limit}`,
          } as never).eq("id", action_id);
          return jsonOk({ action: "skipped_rate_limit", used: rl.used, limit: rl.limit });
        }

        const finalText = (body.use_alt ? action.draft_alt_text : action.draft_text) ?? action.draft_text;

        // Reddit posting
        if (channel === "reddit" && settings.reddit_posting_enabled) {
          const parent = lead?.source_platform_id ? `t3_${lead.source_platform_id}` : null;
          if (!parent) {
            await supabaseAdmin.from("outreach_actions").update({
              status: "failed", failed_reason: "missing_reddit_parent_id",
            } as never).eq("id", action_id);
            return jsonError("missing_reddit_parent_id", 400);
          }
          const r = await redditPostComment(parent, finalText);
          if (r.ok) {
            await supabaseAdmin.from("outreach_actions").update({
              status: "posted", posted_at: new Date().toISOString(), posted_url: r.url ?? null,
            } as never).eq("id", action_id);
            await supabaseAdmin.from("outreach_leads").update({ status: "acted" } as never).eq("id", action.lead_id);
            return jsonOk({ action: "posted", url: r.url });
          }
          await supabaseAdmin.from("outreach_actions").update({
            status: "failed", failed_reason: `reddit_post: ${r.error}`, retry_count: 1,
          } as never).eq("id", action_id);
          return jsonError(r.error ?? "reddit_failed", 502);
        }

        // Telegram auto-reply for live customer chats
        if (channel === "telegram" && settings.telegram_posting_enabled) {
          const raw = (lead?.raw_payload ?? {}) as Record<string, unknown>;
          const source = String(raw.source ?? "");
          const chatId = Number(raw.chat_id ?? 0);
          if (source === "tg_inbox" && Number.isFinite(chatId) && chatId > 0) {
            const send = await telegramSendMessage(chatId, finalText);
            if (send.ok) {
              await supabaseAdmin.from("outreach_actions").update({
                status: "posted",
                posted_at: new Date().toISOString(),
                posted_url: lead?.source_url ?? null,
                failed_reason: null,
              } as never).eq("id", action_id);
              await supabaseAdmin.from("outreach_leads").update({ status: "acted" } as never).eq("id", action.lead_id);
              return jsonOk({ action: "telegram_sent", chat_id: chatId });
            }
            await supabaseAdmin.from("outreach_actions").update({
              status: "failed", failed_reason: send.error ?? "telegram_send_failed", retry_count: 1,
            } as never).eq("id", action_id);
            return jsonError(send.error ?? "telegram_send_failed", 502);
          }
        }

        // Stage 1 fallback: канал не активний для авто-постингу
        await supabaseAdmin.from("outreach_actions").update({
          status: "approved",
          failed_reason: channel === "reddit"
            ? "reddit_posting_disabled_or_no_credentials"
            : channel === "telegram"
              ? "telegram_auto_reply_unavailable_for_this_source"
              : `${channel}_posting_not_enabled_in_stage_1`,
        } as never).eq("id", action_id);
        await supabaseAdmin.from("outreach_leads").update({ status: "queued" } as never).eq("id", action.lead_id);
        return jsonOk({ action: "draft_ready", reason: "Posting disabled — draft saved for manual review." });
      },
    },
  },
});
