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
  source_kind: "insight" | "action" | "notification" | "digest";
  source_id: string | null;
  chat_id: string | null;
  status: string;
  payload?: Record<string, unknown> | null;
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

/**
 * Гуманізація технічних кодів дій/агентів/сутностей у людську мову.
 * Все, що не знайдено — просто прибираємо підкреслення, щоб виглядало читко.
 */
function prettify(s: string): string {
  return s.replace(/_/g, " ");
}
const ACTION_LABELS: Record<string, string> = {
  winback_touch: "написати клієнтові, який давно не повертався",
  reorder_request: "замовити товар у постачальника",
  abandoned_cart_email: "нагадати про незавершений кошик",
  create_seo_page: "створити сторінку під пошуковий запит",
  vip_product_nudge: "запропонувати товар найвірнішим клієнтам",
  update_price: "оновити ціну на товар",
  revert_price: "повернути попередню ціну",
  auto_create_pending_order: "підготувати чернетку замовлення",
  send_broadcast: "розіслати повідомлення клієнтам",
  rewrite_seo_meta: "оновити SEO-заголовок і опис сторінки",
  catalog_fix_checklist: "надіслати чек-лист доопрацювання каталогу",
};
const AGENT_LABELS: Record<string, string> = {
  churn_risk_predictor: "помічник з утримання клієнтів",
  stockout_predictor: "помічник зі складу",
  aov_leak_detector: "помічник із середнього чека",
  search_gap_detector: "помічник із пошуку",
  aov_optimizer: "помічник із середнього чека",
  price_optimizer: "помічник із цін",
  price_revert_safety: "запобіжник цін",
  orchestrator: "диригент агентів",
  telegram_reorder_bot: "бот повторних замовлень",
  "broadcast-composer": "помічник із розсилок",
  "seo-rewriter": "помічник із SEO",
  catalog_enricher: "помічник із каталогу",
};
const ENTITY_LABELS: Record<string, string> = {
  product: "товар",
  customer: "клієнт",
  search_term: "пошуковий запит",
  page: "сторінка",
  orders: "замовлення",
};
const KIND_LABELS: Record<string, string> = {
  test_ping: "тестове повідомлення",
  insight: "підказка",
  action: "дія",
  notification: "сповіщення",
  alert: "увага",
  daily_digest: "щоденне зведення",
};
function humanizeAction(code: string): string {
  return ACTION_LABELS[code] ?? prettify(code);
}
function humanizeAgent(code: string): string {
  return AGENT_LABELS[code] ?? prettify(code);
}
function humanizeEntity(code: string): string {
  return ENTITY_LABELS[code] ?? prettify(code);
}
function humanizeKind(code: string): string {
  return KIND_LABELS[code] ?? prettify(code);
}

async function renderInsight(tenantId: string, insightId: string): Promise<RenderResult> {
  const { data } = await supabaseAdmin
    .from("ai_insights")
    .select("id, title, description, expected_impact, risk_level, insight_type, status, metrics")
    .eq("id", insightId)
    .maybeSingle();
  if (!data || data.status === "applied" || data.status === "dismissed") return null;
  const brand = await getBrandName(tenantId);
  // Перевага — людський «копірайт» з metrics._copy.ua, якщо він є.
  type CopyUa = { headline?: string; why?: string; what_to_do?: string };
  const metricsObj = (data.metrics ?? null) as { _copy?: { ua?: CopyUa } } | null;
  const copyUa: CopyUa = metricsObj?._copy?.ua ?? {};
  const headline = copyUa.headline || data.title;
  const why = copyUa.why || data.description || "";
  const whatToDo = copyUa.what_to_do || "";
  const text = [
    `${severityEmoji(data.risk_level)} <b>${escapeHtml(brand)}</b> · <i>підказка</i>`,
    "",
    `<b>${escapeHtml(headline)}</b>`,
    why ? escapeHtml(why) : "",
    whatToDo ? `\n👉 ${escapeHtml(whatToDo)}` : "",
    data.expected_impact ? `\n💰 Очікуваний ефект: ${escapeHtml(data.expected_impact)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    text,
    buttons: [
      [
        { text: "✅ Зробити", data: `i:apply:${insightId}` },
        { text: "❌ Сховати", data: `i:dismiss:${insightId}` },
      ],
      [{ text: "🔗 Відкрити в кабінеті", data: `i:view:${insightId}` }],
    ],
  };
}

async function renderAction(tenantId: string, actionId: string): Promise<RenderResult> {
  const { data } = await supabaseAdmin
    .from("ai_actions")
    .select(
      "id, agent_id, action_type, expected_impact, target_entity, target_id, status, parameters",
    )
    .eq("id", actionId)
    .maybeSingle();
  if (!data || data.status !== "pending") return null;
  const brand = await getBrandName(tenantId);
  const text = [
    `🤖 <b>${escapeHtml(brand)}</b> · <i>дія, що чекає на твоє «так»</i>`,
    "",
    `<b>${escapeHtml(humanizeAction(data.action_type))}</b>`,
    `Помічник: <i>${escapeHtml(humanizeAgent(data.agent_id))}</i>`,
    data.target_entity
      ? `Стосується: ${escapeHtml(humanizeEntity(data.target_entity))} ${data.target_id ?? ""}`
      : "",
    data.expected_impact ? `\n💰 Очікуваний ефект: ${escapeHtml(data.expected_impact)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    text,
    buttons: [
      [
        { text: "✅ Зробити", data: `a:apply:${actionId}` },
        { text: "❌ Сховати", data: `a:dismiss:${actionId}` },
      ],
      [{ text: "🔗 Відкрити в кабінеті", data: `a:view:${actionId}` }],
    ],
  };
}

async function renderNotification(
  tenantId: string,
  notifId: string,
  payload?: Record<string, unknown> | null,
): Promise<RenderResult> {
  const { data } = await supabaseAdmin
    .from("owner_notifications")
    .select("id, title, body, severity, link, is_read, kind")
    .eq("id", notifId)
    .maybeSingle();
  if (!data || data.is_read) return null;
  const brand = await getBrandName(tenantId);
  const batchedCount = Number(
    (payload as { batched_count?: number } | undefined)?.batched_count ?? 1,
  );
  const batchedTitles = Array.isArray(
    (payload as { batched_titles?: unknown[] } | undefined)?.batched_titles,
  )
    ? ((payload as { batched_titles: unknown[] }).batched_titles.slice(-3) as string[])
    : [];

  const header =
    batchedCount > 1
      ? `${severityEmoji(data.severity)} <b>${escapeHtml(brand)}</b> · <i>${escapeHtml(humanizeKind(data.kind))}</i> · ${batchedCount} нових`
      : `${severityEmoji(data.severity)} <b>${escapeHtml(brand)}</b> · <i>${escapeHtml(humanizeKind(data.kind))}</i>`;

  const bodyText =
    batchedCount > 1 && batchedTitles.length > 0
      ? batchedTitles.map((t) => `• ${escapeHtml(String(t))}`).join("\n")
      : [`<b>${escapeHtml(data.title)}</b>`, data.body ? escapeHtml(data.body) : ""]
          .filter(Boolean)
          .join("\n");

  const text = [header, "", bodyText].filter(Boolean).join("\n");
  const buttons: { text: string; data: string }[][] = [
    [{ text: "✓ Прочитано", data: `n:read:${notifId}` }],
  ];
  if (data.link) {
    buttons.push([{ text: "🔗 Відкрити", data: `n:view:${notifId}` }]);
  }
  return { text, buttons };
}

async function renderForKind(row: OutboxRow): Promise<RenderResult> {
  switch (row.source_kind) {
    case "insight":
      return row.source_id ? renderInsight(row.tenant_id, row.source_id) : null;
    case "action":
      return row.source_id ? renderAction(row.tenant_id, row.source_id) : null;
    case "notification":
      return row.source_id
        ? renderNotification(
            row.tenant_id,
            row.source_id,
            row.payload as Record<string, unknown> | null,
          )
        : null;
    case "digest": {
      const text = (row.payload as { text?: string } | null)?.text;
      if (!text) return null;
      return { text, buttons: [] };
    }
    default:
      return null;
  }
}

async function tgSendCard(
  chatId: string,
  text: string,
  buttons: { text: string; data: string }[][],
  parseMode: "HTML" | "Markdown" = "HTML",
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
      parse_mode: parseMode,
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

async function processRow(
  row: OutboxRow,
): Promise<{ status: "sent" | "skipped" | "failed"; error?: string; message_id?: number }> {
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

  const parseMode =
    (row.payload as { parse_mode?: "HTML" | "Markdown" } | null)?.parse_mode ?? "HTML";
  const sent = await tgSendCard(row.chat_id, card.text, card.buttons, parseMode);
  if (!sent.ok) return { status: "failed", error: sent.error };
  return { status: "sent", message_id: sent.message_id };
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
  if (result.status === "sent") {
    await supabaseAdmin
      .from("owner_telegram_outbox")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        tg_message_id: result.message_id ?? null,
        error: null,
      })
      .eq("id", row.id);
  } else {
    await supabaseAdmin
      .from("owner_telegram_outbox")
      .update({ status: result.status, error: result.error ?? null })
      .eq("id", row.id);
  }
  return result;
}

async function drainPending(limit = 30) {
  const { data: rows } = await supabaseAdmin
    .from("owner_telegram_outbox")
    .select("id, tenant_id, source_kind, source_id, chat_id, status, payload")
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
        new Response(
          JSON.stringify({
            ok: true,
            hint: "POST tenant_id+kind+source_id, or empty body to drain pending",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    },
  },
});
