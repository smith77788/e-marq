/**
 * Outbound channel dispatchers for autonomous messages.
 *
 * Each channel takes a queued `outbound_messages` row and actually delivers it.
 * The dispatcher only knows how to talk to the channel — the decision of *what*
 * to send is made by the engine that queued the row.
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
};

async function getTenantBot(tenantId: string): Promise<TenantBotConfig> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("bot")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data?.bot as TenantBotConfig) ?? {};
}

async function sendTelegram(row: OutboundRow): Promise<{ ok: true; channel_message_id: string } | { ok: false; error: string }> {
  const cfg = await getTenantBot(row.tenant_id);
  const token = cfg.telegram?.bot_token;
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
      // log event so funnel sees it
      await supabaseAdmin.from("events").insert({
        tenant_id: r.tenant_id,
        type: "message_sent",
        payload: { outbound_id: r.id, channel: r.channel } as never,
      });
      // Update customer last_contacted_at
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
