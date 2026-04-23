/**
 * POST /api/telegram/user/queue-action
 * Ставить ручну MTProto-дію власника в чергу tg_user_actions.
 * Виконавець `tg-user-action-executor` пізніше підхоплює та відправляє через bridge.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TENANT_RE, authBearer, canManageTenant, jsonResponse } from "@/lib/telegram/auth";

const PEER = z.union([z.string().min(1).max(256), z.number().int()]);

const SCHEMA = z.discriminatedUnion("action_type", [
  z.object({
    tenant_id: z.string().regex(TENANT_RE),
    prospect_id: z.string().uuid().optional(),
    action_type: z.literal("send_dm"),
    peer: PEER,
    text: z.string().min(1).max(4000),
    reply_to: z.number().int().optional(),
  }),
  z.object({
    tenant_id: z.string().regex(TENANT_RE),
    prospect_id: z.string().uuid().optional(),
    action_type: z.literal("send_comment"),
    peer: PEER,
    message_id: z.number().int(),
    text: z.string().min(1).max(4000),
  }),
  z.object({
    tenant_id: z.string().regex(TENANT_RE),
    prospect_id: z.string().uuid().optional(),
    action_type: z.literal("reaction"),
    peer: PEER,
    message_id: z.number().int(),
    emoji: z.string().min(1).max(8),
    remove: z.boolean().optional(),
  }),
]);

export const Route = createFileRoute("/api/telegram/user/queue-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authBearer(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const raw = await request.json().catch(() => null);
        const parsed = SCHEMA.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse({ error: "invalid_payload", issues: parsed.error.issues }, 400);
        }
        const body = parsed.data;

        const ok = await canManageTenant(auth.userId, body.tenant_id);
        if (!ok) return jsonResponse({ error: "forbidden" }, 403);

        // Перевіримо, що є активна сесія
        const { data: sess } = await supabaseAdmin
          .from("tg_user_sessions")
          .select("status")
          .eq("tenant_id", body.tenant_id)
          .maybeSingle();
        const status = (sess as { status?: string } | null)?.status;
        if (status !== "active") {
          return jsonResponse({ error: "no_active_session" }, 409);
        }

        const { peer, ...rest } = body;
        const target: Record<string, unknown> = { peer };
        if (body.prospect_id) target.prospect_id = body.prospect_id;

        const payload: Record<string, unknown> = {};
        if (rest.action_type === "send_dm") {
          payload.text = rest.text;
          if (rest.reply_to !== undefined) payload.reply_to = rest.reply_to;
        } else if (rest.action_type === "send_comment") {
          payload.text = rest.text;
          payload.message_id = rest.message_id;
        } else if (rest.action_type === "reaction") {
          payload.message_id = rest.message_id;
          payload.emoji = rest.emoji;
          if (rest.remove) payload.remove = true;
        }

        const { data: inserted, error } = await supabaseAdmin
          .from("tg_user_actions")
          .insert({
            tenant_id: body.tenant_id,
            action_type: body.action_type,
            payload: payload as never,
            target: target as never,
            status: "queued",
            scheduled_for: new Date().toISOString(),
            origin: "manual",
            requested_by: auth.userId,
          } as never)
          .select("id, scheduled_for")
          .single();

        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true, action: inserted });
      },
    },
  },
});
