/**
 * Helpers extracted from telegram.poll.ts so the route file stays minimal
 * and the TanStack code-splitter can parse it cleanly.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTelegramText } from "@/lib/acos/channels";
import { handleOwnerCommand, sendOwnerMessage } from "@/lib/telegram/ownerMenu";

export const TG_GATEWAY = "https://connector-gateway.lovable.dev/telegram";
export const MAX_RUNTIME_MS = 25_000;
export const MIN_REMAINING_MS = 5_000;

const YES_PATTERNS =
  /\b(yes|yeah|yep|yup|sure|ok|okay|давай|так|ага|добре|order|купую|беру|готов|хочу)\b/i;
const NO_PATTERNS = /\b(stop|unsubscribe|відпис|стоп|не треба|не зараз|не цікаво|opt[- ]out)\b/i;

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number; first_name?: string; username?: string };
    chat?: { id: number; first_name?: string; username?: string };
    date?: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
};

async function tgAnswerCallback(callbackId: string, text?: string): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) return;
  await fetch(`${TG_GATEWAY}/answerCallbackQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": tgKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text: text ?? "Готово",
      show_alert: false,
    }),
  }).catch(() => undefined);
}

async function tgEditMessage(
  chatId: string | number,
  messageId: number,
  html: string,
): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) return;
  await fetch(`${TG_GATEWAY}/editMessageText`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": tgKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch(() => undefined);
}

function getInternalAgentAuthHeaders(): HeadersInit {
  // Prefer CRON_SECRET so internal hook calls pass isCronToken() check.
  // Falls back to anon key only if CRON_SECRET isn't configured.
  const token = process.env.CRON_SECRET ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  return token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }
    : {
        "Content-Type": "application/json",
      };
}

export async function processCallback(
  cb: NonNullable<TgUpdate["callback_query"]>,
  appOrigin: string,
): Promise<void> {
  const data = cb.data ?? "";
  const chatId = cb.message?.chat.id ?? cb.from.id;
  const msgId = cb.message?.message_id;
  const parts = data.split(":");
  if (parts.length !== 3) {
    await tgAnswerCallback(cb.id, "Невірний запит");
    return;
  }
  const [scope, op, id] = parts as [string, string, string];

  const { data: cfgRow } = await supabaseAdmin
    .from("tenant_configs")
    .select("tenant_id")
    .eq("owner_telegram_chat_id", String(chatId))
    .maybeSingle();
  if (!cfgRow) {
    await tgAnswerCallback(cb.id, "Немає прав");
    return;
  }
  const tenantId = cfgRow.tenant_id;

  if (scope === "i") {
    const { data: ins } = await supabaseAdmin
      .from("ai_insights")
      .select("id, tenant_id, title, status")
      .eq("id", id)
      .maybeSingle();
    if (!ins || ins.tenant_id !== tenantId) {
      await tgAnswerCallback(cb.id, "Не знайдено");
      return;
    }
    if (op === "apply") {
      const res = await fetch(`${appOrigin}/hooks/actions/apply`, {
        method: "POST",
        headers: getInternalAgentAuthHeaders(),
        body: JSON.stringify({ insight_id: id }),
      });
      const errorText = res.ok ? null : await res.text().catch(() => "");
      await tgAnswerCallback(cb.id, res.ok ? "✅ Застосовано" : "Не вдалося застосувати");
      if (!res.ok) {
        await sendTelegramText(
          String(chatId),
          `⚠️ Не вдалося застосувати інсайт${errorText ? `: ${errorText.slice(0, 180)}` : "."}`,
        );
      }
      if (msgId && res.ok)
        await tgEditMessage(chatId, msgId, `✅ <b>Застосовано:</b> ${ins.title}`);
    } else if (op === "dismiss") {
      await supabaseAdmin.from("ai_insights").update({ status: "dismissed" }).eq("id", id);
      await tgAnswerCallback(cb.id, "Сховано");
      if (msgId) await tgEditMessage(chatId, msgId, `❌ <b>Сховано:</b> ${ins.title}`);
    } else if (op === "view") {
      const url = `${appOrigin}/brand?tenant=${tenantId}#insight-${id}`;
      await tgAnswerCallback(cb.id, "Відкриваю…");
      await sendTelegramText(String(chatId), `🔗 ${ins.title}\n${url}`);
    }
  } else if (scope === "a") {
    const { data: act } = await supabaseAdmin
      .from("ai_actions")
      .select("id, tenant_id, action_type, status")
      .eq("id", id)
      .maybeSingle();
    if (!act || act.tenant_id !== tenantId) {
      await tgAnswerCallback(cb.id, "Не знайдено");
      return;
    }
    if (op === "apply") {
      await supabaseAdmin
        .from("ai_actions")
        .update({ status: "applied", applied_at: new Date().toISOString() })
        .eq("id", id);
      await tgAnswerCallback(cb.id, "✅ Застосовано");
      if (msgId)
        await tgEditMessage(chatId, msgId, `✅ <b>Застосовано дію:</b> ${act.action_type}`);
    } else if (op === "dismiss") {
      await supabaseAdmin.from("ai_actions").update({ status: "dismissed" }).eq("id", id);
      await tgAnswerCallback(cb.id, "Сховано");
      if (msgId) await tgEditMessage(chatId, msgId, `❌ <b>Сховано:</b> ${act.action_type}`);
    } else if (op === "view") {
      const url = `${appOrigin}/brand?tenant=${tenantId}#action-${id}`;
      await tgAnswerCallback(cb.id, "Відкриваю…");
      await sendTelegramText(String(chatId), `🔗 ${act.action_type}\n${url}`);
    }
  } else if (scope === "n") {
    const { data: n } = await supabaseAdmin
      .from("owner_notifications")
      .select("id, tenant_id, title, link")
      .eq("id", id)
      .maybeSingle();
    if (!n || n.tenant_id !== tenantId) {
      await tgAnswerCallback(cb.id, "Не знайдено");
      return;
    }
    if (op === "read") {
      await supabaseAdmin.from("owner_notifications").update({ is_read: true }).eq("id", id);
      await tgAnswerCallback(cb.id, "Позначено як прочитане");
      if (msgId) await tgEditMessage(chatId, msgId, `✓ ${n.title}`);
    } else if (op === "view") {
      const url = n.link ?? `${appOrigin}/brand?tenant=${tenantId}`;
      await tgAnswerCallback(cb.id, "Відкриваю…");
      await sendTelegramText(String(chatId), `🔗 ${n.title}\n${url}`);
    }
  } else {
    await tgAnswerCallback(cb.id, "Невідома дія");
  }
}

export async function processMessage(u: TgUpdate, appOrigin: string): Promise<void> {
  const msg = u.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat?.id ?? msg.from?.id ?? "");
  if (!chatId) return;

  const text = msg.text.trim();
  const username = msg.from?.username ?? msg.chat?.username ?? null;
  const firstName = msg.from?.first_name ?? msg.chat?.first_name ?? null;

  // Owner pairing — accepts a one-time code (8 chars) generated in the
  // authenticated dashboard. The legacy form `/start owner <slug>` is now
  // rejected because it let any Telegram user claim ownership of any brand
  // by reading the public storefront slug.
  const ownerStart = text.match(/^\/start\s+owner(?:\s+(\S+))?/i);
  if (ownerStart) {
    const code = (ownerStart[1] ?? "").trim();
    if (!code) {
      await sendTelegramText(
        chatId,
        `Щоб привʼязати власника, відкрийте «Налаштування → Telegram» у MARQ і скопіюйте одноразовий код. Потім надішліть сюди:\n<code>/start owner КОД</code>`,
      );
      return;
    }
    // Reject obviously slug-like inputs (lowercase letters/digits, length>8) early
    // so we don't even hit the DB with crawler traffic.
    const looksLikePairingCode = /^[A-Z0-9]{6,12}$/.test(code);
    if (!looksLikePairingCode) {
      await sendTelegramText(
        chatId,
        `Цей код не схожий на одноразовий. Згенеруйте новий у MARQ → Налаштування → Telegram.`,
      );
      return;
    }
    const { data: pairing } = await supabaseAdmin
      .from("telegram_owner_pairings")
      .select("id, tenant_id, expires_at, consumed_at")
      .eq("pairing_code", code)
      .maybeSingle();
    if (!pairing) {
      await sendTelegramText(chatId, `Код не знайдено або вже використано. Згенеруйте новий.`);
      return;
    }
    if (pairing.consumed_at) {
      await sendTelegramText(chatId, `Цей код уже використано. Згенеруйте новий у MARQ.`);
      return;
    }
    if (new Date(pairing.expires_at).getTime() < Date.now()) {
      await sendTelegramText(chatId, `Код прострочений. Згенеруйте новий у MARQ.`);
      return;
    }
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, name")
      .eq("id", pairing.tenant_id)
      .maybeSingle();
    if (!tenant) {
      await sendTelegramText(chatId, `Бренд не знайдено.`);
      return;
    }
    const { error: rpcErr } = await supabaseAdmin
      .from("tenant_configs")
      .update({ owner_telegram_chat_id: chatId })
      .eq("tenant_id", tenant.id);
    if (rpcErr) {
      await sendTelegramText(chatId, `Не вдалося привʼязати: ${rpcErr.message}`);
      return;
    }
    await supabaseAdmin
      .from("telegram_owner_pairings")
      .update({ consumed_at: new Date().toISOString(), consumed_chat_id: chatId })
      .eq("id", pairing.id);
    await sendOwnerMessage(
      chatId,
      `🔔 Тепер ви отримуєте сповіщення власника для <b>${tenant.name}</b>. Інсайти та дії агентів, що чекають підтвердження, прийдуть сюди з кнопками «Застосувати» / «Сховати».\n\nНатискайте кнопки нижче або надсилайте /menu щоб відкрити кокпіт у Telegram.`,
      true,
    );
    return;
  }

  const startMatch = text.match(/^\/start\s+([a-z0-9_-]+)/i);
  if (startMatch && !ownerStart) {
    const slug = startMatch[1].toLowerCase();
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, slug, name")
      .eq("slug", slug)
      .maybeSingle();
    if (!tenant) {
      await sendTelegramText(
        chatId,
        `Бренд «${slug}» не знайдено. Спитайте у бренду правильне посилання.`,
      );
      return;
    }
    await supabaseAdmin
      .from("telegram_chat_routing")
      .upsert(
        { chat_id: chatId, tenant_id: tenant.id, updated_at: new Date().toISOString() },
        { onConflict: "chat_id" },
      );
    const { data: cfg } = await supabaseAdmin
      .from("tenant_configs")
      .select("brand_name")
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    const brand = cfg?.brand_name ?? tenant.name;
    await sendTelegramText(
      chatId,
      `👋 Вітаємо в <b>${brand}</b>! Запитайте, що завгодно — покажу товари, допоможу замовити або повідомлю про новинки.`,
    );
  }

  const { data: ownerCfg } = await supabaseAdmin
    .from("tenant_configs")
    .select("tenant_id")
    .eq("owner_telegram_chat_id", chatId)
    .maybeSingle();
  if (ownerCfg?.tenant_id) {
    const handled = await handleOwnerCommand(ownerCfg.tenant_id, chatId, text, appOrigin);
    if (handled) return;
  }

  if (text === "/start") {
    await sendTelegramText(
      chatId,
      `Привіт! Клієнтам: <code>/start &lt;slug-бренду&gt;</code>. Власникам: <code>/start owner &lt;slug-бренду&gt;</code>.`,
    );
    return;
  }

  const { data: routing } = await supabaseAdmin
    .from("telegram_chat_routing")
    .select("tenant_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  const tenantId = routing?.tenant_id;
  if (!tenantId) {
    await sendTelegramText(
      chatId,
      `Ви ще не підключені до жодного бренду. Надішліть <code>/start &lt;slug-бренду&gt;</code>, щоб почати.`,
    );
    return;
  }

  let customerId: string | null = null;
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (existing) {
    customerId = existing.id;
    await supabaseAdmin
      .from("customers")
      .update({ telegram_username: username ?? undefined, name: firstName ?? undefined })
      .eq("id", existing.id);
  } else {
    const { data: ins } = await supabaseAdmin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        telegram_chat_id: chatId,
        telegram_username: username,
        name: firstName,
      })
      .select("id")
      .single();
    customerId = ins?.id ?? null;
  }

  if (!customerId) return;

  await supabaseAdmin.from("conversations").insert({
    tenant_id: tenantId,
    customer_id: customerId,
    channel: "telegram",
    external_thread_id: chatId,
    direction: "inbound",
    body: text,
    metadata: { telegram_message_id: msg.message_id, username } as never,
  });
  await supabaseAdmin.from("events").insert({
    tenant_id: tenantId,
    type: "message_received",
    payload: {
      channel: "telegram",
      customer_id: customerId,
      body_preview: text.slice(0, 200),
    } as never,
  });

  const { data: lastOutbound } = await supabaseAdmin
    .from("outbound_messages")
    .select("id, trigger_kind, status")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .in("status", ["sent", "replied"])
    .gte("sent_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastOutbound) {
    await supabaseAdmin
      .from("outbound_messages")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("id", lastOutbound.id);
  }

  if (NO_PATTERNS.test(text)) {
    await supabaseAdmin.from("customers").update({ consent_marketing: false }).eq("id", customerId);
    await sendTelegramText(
      chatId,
      "Зрозуміло — більше повідомлень не надсилаємо. Напишіть START, коли захочете відновити. 👋",
    );
    return;
  }

  if (
    YES_PATTERNS.test(text) &&
    lastOutbound &&
    (lastOutbound.trigger_kind === "reorder" || lastOutbound.trigger_kind === "winback")
  ) {
    const result = await autoCreateReorder(tenantId, customerId);
    if (result) {
      const { data: t } = await supabaseAdmin
        .from("tenants")
        .select("slug")
        .eq("id", tenantId)
        .maybeSingle();
      const link = `${appOrigin}/s/${t?.slug ?? ""}/orders/${result.orderId}`;
      await sendTelegramText(
        chatId,
        `Чудово! Замовлення підготовлено: ${(result.total / 100).toFixed(0)} ₴.\n\nЗавершіть тут 👉 ${link}`,
      );
      await supabaseAdmin.from("ai_actions").insert({
        tenant_id: tenantId,
        agent_id: "telegram_reorder_bot",
        action_type: "auto_create_pending_order",
        status: "applied",
        applied_at: new Date().toISOString(),
        target_entity: "orders",
        target_id: result.orderId,
        parameters: {
          customer_id: customerId,
          source_outbound_id: lastOutbound.id,
          total_cents: result.total,
        } as never,
        actual_result: { order_id: result.orderId } as never,
      });
      return;
    }
  }
}

async function autoCreateReorder(
  tenantId: string,
  customerId: string,
): Promise<{ orderId: string; total: number } | null> {
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("email, name, user_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer?.email) return null;

  const { data: lastOrder } = await supabaseAdmin
    .from("orders")
    .select("id, customer_email, customer_name, customer_user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .ilike("customer_email", customer.email)
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastOrder) return null;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("product_id, product_name, quantity, unit_price_cents")
    .eq("order_id", lastOrder.id);
  if (!items || items.length === 0) return null;

  const total = items.reduce((s, it) => s + it.unit_price_cents * it.quantity, 0);

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      status: "pending",
      total_cents: total,
      currency: "UAH",
      payment_method: "manual",
      customer_email: customer.email,
      customer_name: customer.name ?? lastOrder.customer_name,
      customer_user_id: customer.user_id ?? lastOrder.customer_user_id,
      metadata: { source: "telegram_reorder", from_order_id: lastOrder.id } as never,
    })
    .select("id")
    .single();
  if (error || !order) return null;

  await supabaseAdmin.from("order_items").insert(
    items.map((it) => ({
      tenant_id: tenantId,
      order_id: order.id,
      product_id: it.product_id,
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price_cents: it.unit_price_cents,
    })),
  );
  return { orderId: order.id, total };
}
