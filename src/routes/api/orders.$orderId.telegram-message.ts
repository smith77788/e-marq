/**
 * POST /api/orders/$orderId/telegram-message
 *
 * Owner-side endpoint that lets a brand operator chat with the order's
 * customer through the SHARED Telegram bot. Two-way: outbound messages here
 * land in the customer's Telegram; the customer's replies arrive via the
 * existing long-polling endpoint (`/hooks/telegram/poll`) and are stored in
 * `conversations` for the same chat thread.
 *
 * Security:
 *   - Caller must send a valid Supabase JWT in `Authorization: Bearer …`.
 *   - Caller must be a member (owner/admin/manager) of the order's tenant.
 *   - We resolve the customer's `telegram_chat_id` either from the
 *     `customer_user_id` link or by matching `customer_email`.
 *
 * Request body: { body: string }
 * Response: { ok: true } | { error: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTelegramText } from "@/lib/acos/channels";
import type { Database } from "@/integrations/supabase/types";

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonOk(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveCustomerChatId(
  tenantId: string,
  order: {
    customer_user_id: string | null;
    customer_email: string | null;
  },
): Promise<{ customerId: string; chatId: string } | null> {
  // 1) Direct user link
  if (order.customer_user_id) {
    const { data } = await supabaseAdmin
      .from("customers")
      .select("id, telegram_chat_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", order.customer_user_id)
      .not("telegram_chat_id", "is", null)
      .maybeSingle();
    if (data?.telegram_chat_id) {
      return { customerId: data.id, chatId: data.telegram_chat_id };
    }
  }
  // 2) Email match
  if (order.customer_email) {
    const { data } = await supabaseAdmin
      .from("customers")
      .select("id, telegram_chat_id")
      .eq("tenant_id", tenantId)
      .ilike("email", order.customer_email)
      .not("telegram_chat_id", "is", null)
      .maybeSingle();
    if (data?.telegram_chat_id) {
      return { customerId: data.id, chatId: data.telegram_chat_id };
    }
  }
  return null;
}

export const Route = createFileRoute("/api/orders/$orderId/telegram-message")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const orderId = params.orderId;
        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !anonKey) return jsonError("Server misconfigured", 500);

        // ---- Auth: verify JWT ----
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!token) return jsonError("Unauthorized", 401);

        const userClient = createClient<Database>(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return jsonError("Invalid token", 401);
        const userId = claims.claims.sub;

        // ---- Body ----
        let payload: { body?: unknown };
        try {
          payload = (await request.json()) as { body?: unknown };
        } catch {
          return jsonError("Invalid JSON body");
        }
        const body = typeof payload.body === "string" ? payload.body.trim() : "";
        if (!body) return jsonError("Message body required");
        if (body.length > 3000) return jsonError("Message too long (max 3000 chars)");

        // ---- Load order ----
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("orders")
          .select("id, tenant_id, customer_user_id, customer_email")
          .eq("id", orderId)
          .maybeSingle();
        if (orderErr) return jsonError(orderErr.message, 500);
        if (!order) return jsonError("Order not found", 404);

        // ---- Authorize: caller must be a member of the tenant ----
        const { data: membership } = await supabaseAdmin
          .from("tenant_memberships")
          .select("role")
          .eq("tenant_id", order.tenant_id)
          .eq("user_id", userId)
          .maybeSingle();
        const { data: rolesRow } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .maybeSingle();
        const isSuperAdmin = !!rolesRow;
        if (!membership && !isSuperAdmin) {
          return jsonError("Forbidden — not a member of this brand", 403);
        }

        // ---- Resolve customer Telegram chat ----
        const target = await resolveCustomerChatId(order.tenant_id, order);
        if (!target) {
          return jsonError(
            "Покупець ще не прив’язав Telegram. Попросіть надіслати /start <slug> нашому боту.",
            409,
          );
        }

        // ---- Send ----
        const result = await sendTelegramText(target.chatId, body);
        if (!result.ok) return jsonError(`Telegram: ${result.error}`, 502);

        // ---- Persist as outbound conversation entry ----
        await supabaseAdmin.from("conversations").insert({
          tenant_id: order.tenant_id,
          customer_id: target.customerId,
          channel: "telegram",
          direction: "outbound",
          external_thread_id: target.chatId,
          body,
          metadata: {
            order_id: order.id,
            sent_by_user_id: userId,
            telegram_message_id: result.message_id,
          } as never,
        });

        // ---- Outbound log for analytics ----
        await supabaseAdmin.from("outbound_messages").insert({
          tenant_id: order.tenant_id,
          customer_id: target.customerId,
          channel: "telegram",
          status: "sent",
          sent_at: new Date().toISOString(),
          trigger_kind: "owner_reply",
          body,
          metadata: { order_id: order.id, sent_by_user_id: userId } as never,
        });

        return jsonOk({ chat_id: target.chatId });
      },
    },
  },
});
