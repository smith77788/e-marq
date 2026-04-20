/**
 * Telegram bot webhook receiver.
 *
 * URL: /hooks/telegram/webhook/{tenant_slug}
 *
 * Telegram sends Update objects here whenever a customer messages the bot.
 * We:
 *  1. Resolve the tenant by slug.
 *  2. Upsert the customer (by telegram_chat_id).
 *  3. Insert into `conversations` (direction=inbound).
 *  4. Insert into `events` (type=message_received).
 *
 * The autonomous sales bot reads `conversations` later (Phase 3).
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

export const Route = createFileRoute("/hooks/telegram/webhook/$tenant")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const slug = params.tenant;
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        if (!tenant) return new Response("Unknown tenant", { status: 404 });

        let update: TgUpdate;
        try {
          update = (await request.json()) as TgUpdate;
        } catch {
          return new Response("ok", { status: 200 });
        }
        const msg = update.message;
        if (!msg?.text) return new Response("ok", { status: 200 });

        const chatId = String(msg.chat?.id ?? msg.from?.id ?? "");
        if (!chatId) return new Response("ok", { status: 200 });

        const username = msg.from?.username ?? msg.chat?.username ?? null;
        const firstName = msg.from?.first_name ?? msg.chat?.first_name ?? null;

        // Upsert customer
        let customerId: string | null = null;
        const { data: existing } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("telegram_chat_id", chatId)
          .maybeSingle();
        if (existing) {
          customerId = existing.id;
          await supabaseAdmin
            .from("customers")
            .update({
              telegram_username: username ?? undefined,
              name: firstName ?? undefined,
            })
            .eq("id", existing.id);
        } else {
          const { data: ins } = await supabaseAdmin
            .from("customers")
            .insert({
              tenant_id: tenant.id,
              telegram_chat_id: chatId,
              telegram_username: username,
              name: firstName,
            })
            .select("id")
            .single();
          customerId = ins?.id ?? null;
        }

        await supabaseAdmin.from("conversations").insert({
          tenant_id: tenant.id,
          customer_id: customerId,
          channel: "telegram",
          external_thread_id: chatId,
          direction: "inbound",
          body: msg.text,
          metadata: { telegram_message_id: msg.message_id, username } as never,
        });

        await supabaseAdmin.from("events").insert({
          tenant_id: tenant.id,
          type: "message_received",
          payload: { channel: "telegram", customer_id: customerId, body_preview: msg.text.slice(0, 200) } as never,
        });

        // Mark any pending winback/reorder message as replied if this came from same customer
        if (customerId) {
          await supabaseAdmin
            .from("outbound_messages")
            .update({ status: "replied", replied_at: new Date().toISOString() })
            .eq("tenant_id", tenant.id)
            .eq("customer_id", customerId)
            .eq("status", "sent")
            .gte("sent_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
