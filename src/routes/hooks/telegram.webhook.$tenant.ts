/**
 * Telegram bot webhook receiver — now CONVERSATIONAL.
 *
 * URL: /hooks/telegram/webhook/{tenant_slug}
 *
 * Flow:
 *  1. Resolve tenant + upsert customer.
 *  2. Insert into conversations + events.
 *  3. Mark any recent outbound as `replied`.
 *  4. NEW — detect AFFIRMATIVE intent ("yes / так / ok / давай / sure"):
 *     if the most recent outbound to this customer is a `reorder` or `winback`,
 *     auto-create a pending order from their last paid order items and
 *     reply with a payment link `/s/{slug}/orders/{id}`.
 *  5. NEW — detect NEGATIVE / STOP intent: opt-out, set consent_marketing=false.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type TgUpdate = {
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number; first_name?: string; username?: string };
    chat?: { id: number; first_name?: string; username?: string };
    date?: number;
  };
};

const YES_PATTERNS = /\b(yes|yeah|yep|yup|sure|ok|okay|давай|так|ага|добре|так\,?\s*давай|order|купую|беру|готов|хочу)\b/i;
const NO_PATTERNS = /\b(stop|unsubscribe|no|not now|відпис|стоп|не треба|не зараз|не цікаво|opt[- ]out)\b/i;

function appOrigin(request: Request): string {
  return new URL(request.url).origin;
}

async function getTenantBotToken(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("bot")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const bot = data?.bot as { telegram?: { bot_token?: string } } | null;
  return bot?.telegram?.bot_token ?? null;
}

async function tgReply(token: string, chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

/**
 * Build a pending order from the customer's most recent paid order. Returns the new order id.
 */
async function autoCreateReorder(tenantId: string, customerId: string): Promise<{ orderId: string; total: number } | null> {
  const { data: customer } = await supabaseAdmin
    .from("customers").select("email, name, user_id").eq("id", customerId).maybeSingle();
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
      currency: "USD",
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

export const Route = createFileRoute("/hooks/telegram/webhook/$tenant")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const slug = params.tenant;
        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id, slug").eq("slug", slug).maybeSingle();
        if (!tenant) return new Response("Unknown tenant", { status: 404 });

        let update: TgUpdate;
        try { update = (await request.json()) as TgUpdate; }
        catch { return new Response("ok", { status: 200 }); }
        const msg = update.message;
        if (!msg?.text) return new Response("ok", { status: 200 });

        const chatId = String(msg.chat?.id ?? msg.from?.id ?? "");
        if (!chatId) return new Response("ok", { status: 200 });

        const username = msg.from?.username ?? msg.chat?.username ?? null;
        const firstName = msg.from?.first_name ?? msg.chat?.first_name ?? null;

        // 1. Upsert customer
        let customerId: string | null = null;
        const { data: existing } = await supabaseAdmin
          .from("customers").select("id").eq("tenant_id", tenant.id).eq("telegram_chat_id", chatId).maybeSingle();
        if (existing) {
          customerId = existing.id;
          await supabaseAdmin.from("customers").update({
            telegram_username: username ?? undefined, name: firstName ?? undefined,
          }).eq("id", existing.id);
        } else {
          const { data: ins } = await supabaseAdmin.from("customers").insert({
            tenant_id: tenant.id, telegram_chat_id: chatId, telegram_username: username, name: firstName,
          }).select("id").single();
          customerId = ins?.id ?? null;
        }

        // 2. Conversation + event
        await supabaseAdmin.from("conversations").insert({
          tenant_id: tenant.id, customer_id: customerId, channel: "telegram",
          external_thread_id: chatId, direction: "inbound", body: msg.text,
          metadata: { telegram_message_id: msg.message_id, username } as never,
        });
        await supabaseAdmin.from("events").insert({
          tenant_id: tenant.id, type: "message_received",
          payload: { channel: "telegram", customer_id: customerId, body_preview: msg.text.slice(0, 200) } as never,
        });

        if (!customerId) return new Response("ok", { status: 200 });

        // 3. Find the most recent outbound this is a reply to (for status update + intent context)
        const { data: lastOutbound } = await supabaseAdmin
          .from("outbound_messages")
          .select("id, trigger_kind, status, sent_at")
          .eq("tenant_id", tenant.id).eq("customer_id", customerId)
          .in("status", ["sent", "replied"])
          .gte("sent_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
          .order("sent_at", { ascending: false }).limit(1).maybeSingle();

        if (lastOutbound) {
          await supabaseAdmin
            .from("outbound_messages")
            .update({ status: "replied", replied_at: new Date().toISOString() })
            .eq("id", lastOutbound.id);
        }

        // 4. Intent detection
        const text = msg.text.trim();
        const isYes = YES_PATTERNS.test(text);
        const isNo = NO_PATTERNS.test(text);
        const token = await getTenantBotToken(tenant.id);

        if (isNo) {
          await supabaseAdmin.from("customers").update({ consent_marketing: false }).eq("id", customerId);
          if (token) await tgReply(token, chatId, "Got it — you're opted out. Reply START anytime to resume. 👋");
          return new Response("ok", { status: 200 });
        }

        if (isYes && lastOutbound && (lastOutbound.trigger_kind === "reorder" || lastOutbound.trigger_kind === "winback")) {
          const result = await autoCreateReorder(tenant.id, customerId);
          if (result && token) {
            const link = `${appOrigin(request)}/s/${tenant.slug}/orders/${result.orderId}`;
            await tgReply(
              token,
              chatId,
              `Sweet! I prepared your order: $${(result.total / 100).toFixed(2)}.\n\nFinish here 👉 ${link}`,
            );
            // Bookkeeping: log auto-action
            await supabaseAdmin.from("ai_actions").insert({
              tenant_id: tenant.id,
              agent_id: "telegram_reorder_bot",
              action_type: "auto_create_pending_order",
              status: "applied",
              applied_at: new Date().toISOString(),
              target_entity: "orders",
              target_id: result.orderId,
              parameters: { customer_id: customerId, source_outbound_id: lastOutbound.id, total_cents: result.total } as never,
              actual_result: { order_id: result.orderId } as never,
            });
            return new Response("ok", { status: 200 });
          }
          if (token) await tgReply(token, chatId, "I couldn't auto-prepare your order — let me get a human to help. Hold on a sec! 🙏");
        }

        // Fall-through: sales-bot agent will pick it up on next cron tick.
        return new Response("ok", { status: 200 });
      },
    },
  },
});
