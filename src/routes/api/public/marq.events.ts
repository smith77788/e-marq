/**
 * POST /api/public/marq/events
 *
 * Brand storefront → MARQ event ingestion. Auth via tenant API key
 * (tier ≥ public_write, scope `events:write`). Body is a single event
 * matching `events.type` enum, validated by Zod.
 *
 * Rate-limit: relies on Cloudflare's per-IP throttling + the existing
 * `anon_event_rate_limit` table (per session_id, 1 minute buckets).
 * We keep payloads small (<8 KB) to avoid abuse.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeMarqApiKey, jsonResponse, preflight } from "@/lib/marq-public-api/auth";

const EVENT_TYPES = [
  "product_viewed", "add_to_cart", "checkout_started", "purchase_completed",
  "reorder_clicked", "bot_interaction", "content_viewed", "inactivity_detected",
  "message_sent", "message_received", "session_start", "reorder_triggered",
  "page_viewed", "product_clicked", "remove_from_cart", "cart_viewed",
  "begin_checkout", "checkout_clicked", "checkout_viewed", "checkout_abandoned",
  "checkout_failed", "offer_shown", "offer_skipped", "upsell_accepted",
  "upsell_dismissed", "exit_intent_shown", "exit_intent_dismissed",
  "exit_intent_converted", "bot_started", "search_performed", "wishlist_added",
  "wishlist_removed", "review_submitted", "promo_applied", "promo_failed",
  "share_clicked", "phone_call_clicked", "telegram_link_clicked", "chat_opened",
  "chat_message_sent", "newsletter_signup", "ai_chat_product_click",
  "ai_chat_product_recommended", "reorder_completed", "app_opened",
  "deep_link_opened", "push_received", "push_opened", "oauth_callback_success",
  "apk_install_prompt_shown", "apk_install_prompt_clicked",
  "apk_install_prompt_dismissed", "bot_reorder_reminder_sent",
  "referral_link_copied", "referral_link_shared", "referral_clicked",
  "referral_rewarded",
] as const;

const BodySchema = z.object({
  type: z.enum(EVENT_TYPES),
  session_id: z.string().min(1).max(128).optional(),
  product_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const RATE_LIMIT_PER_MINUTE = 120;

export const Route = createFileRoute("/api/public/marq/events")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        const auth = await authorizeMarqApiKey(request, {
          scope: "events:write",
          minTier: "public_write",
        });
        if ("error" in auth) return jsonResponse({ error: auth.error }, { status: auth.status });

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (err) {
          return jsonResponse(
            { error: err instanceof Error ? err.message : "Invalid body" },
            { status: 400 },
          );
        }

        // Throttle by session_id (best-effort — table is INSERT-friendly).
        if (body.session_id) {
          const bucketMinute = new Date();
          bucketMinute.setSeconds(0, 0);
          const bucketIso = bucketMinute.toISOString();
          const { data: existing } = await supabaseAdmin
            .from("anon_event_rate_limit")
            .select("count")
            .eq("tenant_id", auth.tenantId)
            .eq("session_id", body.session_id)
            .eq("bucket_minute", bucketIso)
            .maybeSingle();
          const current = existing?.count ?? 0;
          if (current >= RATE_LIMIT_PER_MINUTE) {
            return jsonResponse({ error: "Rate limit exceeded" }, { status: 429 });
          }
          await supabaseAdmin.from("anon_event_rate_limit").upsert(
            {
              tenant_id: auth.tenantId,
              session_id: body.session_id,
              bucket_minute: bucketIso,
              count: current + 1,
            },
            { onConflict: "tenant_id,session_id,bucket_minute" },
          );
        }

        const { error } = await supabaseAdmin.from("events").insert({
          tenant_id: auth.tenantId,
          type: body.type,
          session_id: body.session_id ?? null,
          product_id: body.product_id ?? null,
          order_id: body.order_id ?? null,
          user_id: body.user_id ?? null,
          payload: (body.payload ?? {}) as never,
        });
        if (error) return jsonResponse({ error: error.message }, { status: 500 });

        return jsonResponse({ ok: true });
      },
    },
  },
});
