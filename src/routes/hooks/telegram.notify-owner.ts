/**
 * Push to owner's Telegram chat with inline buttons (Apply / Dismiss / View).
 *
 * Triggered by DB triggers via pg_net (after INSERT on ai_insights, ai_actions,
 * owner_notifications), with fallback batch processing of pending outbox rows.
 *
 * Body: { tenant_id, kind, source_id }  → push single
 * Body: {} (or no body)                  → drain pending outbox (cron-friendly)
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TG_GATEWAY = "https://connector-gateway.lovable.dev/telegram";
const APP_BASE = process.env.APP_BASE_URL ?? "https://e-marq.lovable.app";

type OutboxRow = {
  id: string;
  tenant_id: string;
  source_kind: "insight" | "action" | "notification";
  source_id: string;
  chat_id: string | null;
  status: string;
};

type RenderResult = { text: string; buttons: { text: string; data: string }[][] } | null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function severityEmoji(level: string | null | undefined): string {
  switch (level) {
    case "critical":
      return "🚨";
    case "high":
      return "🔴";
    case "medium":
      return "🟡";
    case "low":
      return "🟢";
    default:
      return "💡";
  }
}

async function getBrandName(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data?.brand_name ?? "Brand";
}

async function renderInsight(tenantId: string, insightId: string): Promise<RenderResult> {
  const { data } = await supabaseAdmin
    .from("ai_insights")
    .select("id, title, description, expected_impact, risk_level, insight_type, status")
    .eq("id", insightId)
    .maybeSingle();
  if (!data || data.status === "applied" || data.status === "dismissed") return null;
  const brand = await getBrandName(tenantId);
  const text = [
    `${severityEmoji(data.risk_level)} <b>${escapeHtml(brand)}</b> · <i>insight</i>`,
    "",
    `<b>${escapeHtml(data.title)}</b>`,
    data.description ? escapeHtml(data.description) : "",
    data.expected_impact ? `\n💰 ${escapeHtml(data.expected_impact)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    text,
    buttons: [
      [
        { text: "✅ Apply", data: `i:apply:${insightId}` },
        { text: "❌ Dismiss", data: `i:dismiss:${insightId}` },
      ],
      [{ text: "🔗 View in dashboard", data: `i:view:${insightId}` }],
    ],
  };
}

async function renderAction(tenantId: string, actionId: string): Promise<RenderResult> {
  const { data } = await supabaseAdmin
    .from("ai_actions")
    .select("id, agent_id, action_type, expected_impact, target_entity, target_id, status, parameters")
    .eq("id", actionId)
    .maybeSingle();
  if (!data || data.status !== "pending") return null;
  const brand = await getBrandName(tenantId);
  const text = [
    `🤖 <b>${escapeHtml(brand)}</b> · <i>agent action awaiting approval</i>`,
    "",
    `<b>${escapeHtml(data.action_type.replace(/_/g, " "))}</b>`,
    `Agent: <code>${escapeHtml(data.agent_id)}</code>`,
    data.target_entity ? `Target: ${escapeHtml(data.target_entity)} ${data.target_id ?? ""}` : "",
    data.expected_impact ? `\n💰 ${escapeHtml(data.expected_impact)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    text,
    buttons: [
      [
        { text: "✅ Apply", data: `a:apply:${actionId}` },
        { text: "❌ Dismiss", data: `a:dismiss:${actionId}` },
      ],
      [{ text: "🔗 View in dashboard", data: `a:view:${actionId}` }],
    ],
  };
}

async function renderNotification(tenantId: string, notifId: string): Promise<RenderResult> {
  const { data } = await supabaseAdmin
    .from("owner_notifications")
    .select("id, title, body, severity, link, is_read, kind")
    .eq("id", notifId)
    .maybeSingle();
  if (!data || data.is_read) return null;
  const brand = await getBrandName(tenantId);
  const text = [
    `${severityEmoji(data.severity)} <b>${escapeHtml(brand)}</b> · <i>${escapeHtml(data.kind)}</i>`,
    "",
    `<b>${escapeHtml(data.title)}</b>`,
    data.body ? escapeHtml(data.body) : "",
  ]
    .filter(Boolean)
    .join("\n");
  const buttons: { text: string; data: string }[][] = [
    [{ text: "✓ Mark as read", data: `n:read:${notifId}` }],
  ];
  if (data.link) {
    buttons.push([{ text: "🔗 Open", data: `n:view:${notifId}` }]);
  }
  return { text, buttons };
}

async function renderForKind(row: OutboxRow): Promise<RenderResult> {
  switch (row.source_kind) {
    case "insight":
      return renderInsight(row.tenant_id, row.source_id);
    case "action":
      return renderAction(row.tenant_id, row.source_id);
    case "notification":
      return renderNotification(row.tenant_id, row.source_id);
  }
}

async function tgSendCard(
  chatId: string,
  text: string,
  buttons: { text: string; data: string }[][],
): Promise<{ ok: true; message_id: number } | { ok: false; error: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) return { ok: false, error: "telegram connector not configured" };

  const res = await fetch(`${TG_GATEWAY}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": tgKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: buttons.map((row) =>
          row.map((b) =>
            b.data.startsWith("http")
              ? { text: b.text, url: b.data }
              : { text: b.text, callback_data: b.data },
          ),
        ),
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  if (!res.ok || !json.ok || !json.result?.message_id) {
    return { ok: false, error: json.description ?? `HTTP ${res.status}` };
  }
  return { ok: true, message_id: json.result.message_id };
}

async function processRow(row: OutboxRow): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  if (!row.chat_id) {
    // refresh chat from tenant_configs in case it was set after enqueue
    const { data: cfg } = await supabaseAdmin
      .from("tenant_configs")
      .select("owner_telegram_chat_id")
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    const chat = cfg?.owner_telegram_chat_id;
    if (!chat) return { status: "skipped", error: "owner chat not set" };
    row.chat_id = chat;
  }

  const card = await renderForKind(row);
  if (!card) return { status: "skipped", error: "source no longer actionable" };

  const sent = await tgSendCard(row.chat_id, card.text, card.buttons);
  if (!sent.ok) return { status: "failed", error: sent.error };
  return { status: "sent", error: String(sent.message_id) };
}

async function handleSingle(tenantId: string, kind: OutboxRow["source_kind"], sourceId: string) {
  const { data: existing } = await supabaseAdmin
    .from("owner_telegram_outbox")
    .select("id, tenant_id, source_kind, source_id, chat_id, status, tg_message_id")
    .eq("tenant_id", tenantId)
    .eq("source_kind", kind)
    .eq("source_id", sourceId)
    .maybeSingle();

  if (!existing) {
    // trigger should have created it; create now defensively
    const { data: cfg } = await supabaseAdmin
      .from("tenant_configs")
      .select("owner_telegram_chat_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!cfg?.owner_telegram_chat_id) return { status: "skipped" as const };
    const { data: ins } = await supabaseAdmin
      .from("owner_telegram_outbox")
      .insert({
        tenant_id: tenantId,
        source_kind: kind,
        source_id: sourceId,
        chat_id: cfg.owner_telegram_chat_id,
      })
      .select("id, tenant_id, source_kind, source_id, chat_id, status")
      .single();
    if (!ins) return { status: "failed" as const };
    return await pushAndUpdate(ins as OutboxRow);
  }

  if (existing.status === "sent") return { status: "skipped" as const, reason: "already sent" };
  return await pushAndUpdate(existing as OutboxRow);
}

async function pushAndUpdate(row: OutboxRow) {
  const result = await processRow(row);
  const update: Record<string, unknown> = { status: result.status };
  if (result.status === "sent") {
    update.sent_at = new Date().toISOString();
    update.tg_message_id = Number(result.error);
    update.error = null;
  } else if (result.status === "failed") {
    update.error = result.error ?? null;
  } else {
    update.error = result.error ?? null;
  }
  await supabaseAdmin.from("owner_telegram_outbox").update(update).eq("id", row.id);
  return result;
}

async function drainPending(limit = 30) {
  const { data: rows } = await supabaseAdmin
    .from("owner_telegram_outbox")
    .select("id, tenant_id, source_kind, source_id, chat_id, status")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  let sent = 0,
    failed = 0,
    skipped = 0;
  for (const r of (rows ?? []) as OutboxRow[]) {
    const res = await pushAndUpdate(r);
    if (res.status === "sent") sent++;
    else if (res.status === "failed") failed++;
    else skipped++;
  }
  return { sent, failed, skipped, total: (rows ?? []).length };
}

export const Route = createFileRoute("/hooks/telegram/notify-owner")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { tenant_id?: string; kind?: string; source_id?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          // empty body → drain mode
        }

        if (body.tenant_id && body.kind && body.source_id) {
          const validKinds = ["insight", "action", "notification"] as const;
          if (!validKinds.includes(body.kind as (typeof validKinds)[number])) {
            return new Response(JSON.stringify({ ok: false, error: "invalid kind" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const result = await handleSingle(
            body.tenant_id,
            body.kind as OutboxRow["source_kind"],
            body.source_id,
          );
          return new Response(JSON.stringify({ ok: true, ...result, app_base: APP_BASE }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const summary = await drainPending();
        return new Response(JSON.stringify({ ok: true, ...summary }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () =>
        new Response(JSON.stringify({ ok: true, hint: "POST tenant_id+kind+source_id, or empty body to drain pending" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
