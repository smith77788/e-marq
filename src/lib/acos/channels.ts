/**
 * Outbound channel dispatchers for autonomous messages.
 *
 * Telegram is now sent through the **shared Lovable connector** (one bot for the
 * whole platform). Tenants no longer need their own bot token. Customers bind
 * their chat to a tenant by sending `/start <slug>` to the shared bot — see
 * src/routes/hooks/telegram.poll.ts.
 *
 * Email still uses Resend if RESEND_API_KEY is configured.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";

export type OutboundRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  channel: string;
  body: string;
  metadata: Record<string, unknown>;
};

const TG_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

type TenantBotConfig = {
  email?: { from?: string; reply_to?: string };
};

async function getTenantBot(
  tenantId: string,
): Promise<{ bot: TenantBotConfig; brandName: string }> {
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

/** Send a Telegram message via the Lovable shared connector gateway. */
export async function sendTelegramText(
  chatId: string,
  text: string,
): Promise<{ ok: true; message_id: string } | { ok: false; error: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY missing" };
  if (!tgKey) return { ok: false, error: "TELEGRAM_API_KEY missing (connector not linked)" };

  const res = await fetch(`${TG_GATEWAY}/sendMessage`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
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
    }),
  }).catch((err: unknown) => {
    throw new Error(`Telegram gateway timeout/error: ${err instanceof Error ? err.message : String(err)}`);
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  if (!res.ok || !json.ok) {
    return { ok: false, error: json.description ?? `HTTP ${res.status}` };
  }
  return { ok: true, message_id: String(json.result?.message_id ?? "") };
}

async function sendTelegramOutbound(
  row: OutboundRow,
): Promise<{ ok: true; channel_message_id: string } | { ok: false; error: string }> {
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("telegram_chat_id")
    .eq("id", row.customer_id ?? "")
    .maybeSingle();
  const chatId = customer?.telegram_chat_id;
  if (!chatId) return { ok: false, error: "Customer has no telegram_chat_id" };

  const result = await sendTelegramText(chatId, row.body);
  if (!result.ok) return result;
  return { ok: true, channel_message_id: result.message_id };
}

function bodyToHtml(body: string): string {
  return body
    .split("\n")
    .map((l) => l)
    .join("<br>");
}

async function sendEmail(
  row: OutboundRow,
): Promise<{ ok: true; channel_message_id: string } | { ok: false; error: string }> {
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("email, name, unsubscribe_token")
    .eq("id", row.customer_id ?? "")
    .maybeSingle();
  const to = customer?.email;
  if (!to) return { ok: false, error: "Customer has no email" };

  const { brandName } = await getTenantBot(row.tenant_id);

  // Use first non-empty text line as subject (strip HTML tags)
  const firstLine =
    row.body
      .split("\n")[0]
      ?.replace(/<[^>]+>/g, "")
      .trim() ?? "";
  const subject =
    firstLine.length > 4 && firstLine.length < 80
      ? firstLine
      : `Повідомлення від ${brandName}`;

  const result = await sendEmailViaGateway({
    to,
    subject,
    html: bodyToHtml(row.body),
    fromName: brandName,
    tenantId: row.tenant_id,
    category: "marketing",
    unsubscribeToken: customer?.unsubscribe_token ?? undefined,
    tags: [
      { name: "template", value: row.metadata?.template_key as string ?? "outbound_auto" },
      { name: "tenant", value: row.tenant_id.slice(0, 16) },
    ],
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, channel_message_id: result.id };
}

/** Process all due outbound messages for a tenant. */
export async function dispatchTenantOutbound(
  tenantId: string,
  limit = 50,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data: rows, error } = await supabaseAdmin
    .from("outbound_messages")
    .select("id, tenant_id, customer_id, channel, body, metadata")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let sent = 0,
    failed = 0,
    skipped = 0;
  for (const r of (rows ?? []) as OutboundRow[]) {
    let result: { ok: true; channel_message_id: string } | { ok: false; error: string };
    if (r.channel === "telegram") {
      result = await sendTelegramOutbound(r);
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
export async function pickChannelForCustomer(
  customerId: string,
): Promise<"telegram" | "email" | null> {
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
