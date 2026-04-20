/**
 * Outbound channel dispatchers for autonomous messages.
 *
 * Each channel takes a queued `outbound_messages` row and actually delivers it.
 * The dispatcher only knows how to talk to the channel — the decision of *what*
 * to send is made by the engine that queued the row.
 *
 * Supported channels: telegram, email (Resend).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type OutboundRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  channel: string;
  body: string;
  metadata: Record<string, unknown>;
};

type TenantBotConfig = {
  telegram?: { bot_token?: string };
  email?: { from?: string; reply_to?: string };
};

async function getTenantBot(tenantId: string): Promise<{ bot: TenantBotConfig; brandName: string }> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("bot, brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return {
    bot: (data?.bot as TenantBotConfig) ?? {},
    brandName: data?.brand_name ?? "Brand",
  };
}

async function sendTelegram(row: OutboundRow): Promise<{ ok: true; channel_message_id: string } | { ok: false; error: string }> {
  const { bot } = await getTenantBot(row.tenant_id);
  const token = bot.telegram?.bot_token;
  if (!token) return { ok: false, error: "Telegram bot token not configured for tenant" };

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("telegram_chat_id")
    .eq("id", row.customer_id ?? "")
    .maybeSingle();
  const chatId = customer?.telegram_chat_id;
  if (!chatId) return { ok: false, error: "Customer has no telegram_chat_id" };

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: row.body, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
  if (!res.ok || !json.ok) return { ok: false, error: json.description ?? `HTTP ${res.status}` };
  return { ok: true, channel_message_id: String(json.result?.message_id ?? "") };
}

function bodyToHtml(body: string): string {
  // body may already contain <b> etc. Convert newlines to <br>.
  return body.split("\n").map((l) => l).join("<br>");
}

async function sendEmail(row: OutboundRow): Promise<{ ok: true; channel_message_id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const { bot, brandName } = await getTenantBot(row.tenant_id);
  const from = bot.email?.from ?? "noreply@resend.dev";
  const replyTo = bot.email?.reply_to;

  const { data: customer } = await supabaseAdmin
    .from("customers").select("email, name").eq("id", row.customer_id ?? "").maybeSingle();
  const to = customer?.email;
  if (!to) return { ok: false, error: "Customer has no email" };

  // Subject: derive from first line, fallback to a sensible default.
  const firstLine = row.body.split("\n")[0]?.replace(/<[^>]+>/g, "").trim() ?? "";
  const subject = firstLine.length > 4 && firstLine.length < 80 ? firstLine : `A note from ${brandName}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: `${brandName} <${from}>`,
      to: [to],
      subject,
      html: bodyToHtml(row.body),
      reply_to: replyTo,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !json.id) return { ok: false, error: json.message ?? json.name ?? `HTTP ${res.status}` };
  return { ok: true, channel_message_id: json.id };
}

/** Process all due outbound messages for a tenant. Returns count sent. */
export async function dispatchTenantOutbound(tenantId: string, limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data: rows, error } = await supabaseAdmin
    .from("outbound_messages")
    .select("id, tenant_id, customer_id, channel, body, metadata")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let sent = 0, failed = 0, skipped = 0;
  for (const r of (rows ?? []) as OutboundRow[]) {
    let result: { ok: true; channel_message_id: string } | { ok: false; error: string };
    if (r.channel === "telegram") {
      result = await sendTelegram(r);
    } else if (r.channel === "email") {
      result = await sendEmail(r);
    } else {
      skipped++;
      continue;
    }
    const now = new Date().toISOString();
    if (result.ok) {
      await supabaseAdmin
        .from("outbound_messages")
        .update({ status: "sent", sent_at: now, channel_message_id: result.channel_message_id })
        .eq("id", r.id);
      await supabaseAdmin.from("events").insert({
        tenant_id: r.tenant_id,
        type: "message_sent",
        payload: { outbound_id: r.id, channel: r.channel } as never,
      });
      if (r.customer_id) {
        await supabaseAdmin
          .from("customers")
          .update({ last_contacted_at: now })
          .eq("id", r.customer_id);
      }
      sent++;
    } else {
      await supabaseAdmin
        .from("outbound_messages")
        .update({ status: "failed", error: result.error })
        .eq("id", r.id);
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/** Pick best channel for a customer. Telegram first (free + interactive), email fallback. */
export async function pickChannelForCustomer(customerId: string): Promise<"telegram" | "email" | null> {
  const { data } = await supabaseAdmin
    .from("customers")
    .select("telegram_chat_id, email, consent_marketing")
    .eq("id", customerId)
    .maybeSingle();
  if (!data || !data.consent_marketing) return null;
  if (data.telegram_chat_id) return "telegram";
  if (data.email) return "email";
  return null;
}
