/**
 * Public event ingest. ANY storefront / external script POSTs here.
 *
 * Adaptive design:
 *   • Accepts any event_type currently in the public.event_type enum.
 *   • Auto-resolves customers by email OR telegram_chat_id OR external user_id.
 *   • For type === "purchase_completed", auto-upserts an `orders` row
 *     so downstream agents (LTV, retention, fraud) work without a separate
 *     order webhook.
 *   • Optional `created_at` ISO string — supports historical backfill from
 *     the storefront's local DB.
 *
 * Body:
 * {
 *   tenant_slug: "basic-food",   // OR tenant_id
 *   tenant_id?: string,
 *   type: "<any event_type>",
 *   session_id?: string,
 *   created_at?: string,         // ISO; defaults to now()
 *   customer?: {
 *     email?, name?, telegram_chat_id?, telegram_username?, user_id?
 *   },
 *   product_id?: string,
 *   order_id?: string,
 *   payload?: Record<string, unknown>,
 *   // For purchase_completed convenience:
 *   total_cents?: number,
 *   currency?: string,
 *   items?: Array<{ product_id?, product_name, quantity, unit_price_cents }>
 * }
 *
 * Returns 200 even when the event type is unknown — we log it as
 * `content_viewed` with original type stored in payload.original_type so
 * the storefront integration never breaks because of an enum mismatch.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError } from "@/lib/acos/agentRuntime";
import type { Database } from "@/integrations/supabase/types";

type EventType = Database["public"]["Enums"]["event_type"];

// Authoritative list — must match the public.event_type enum in the DB.
// If you ALTER TYPE … ADD VALUE, append it here too.
const VALID_TYPES: EventType[] = [
  "product_viewed",
  "add_to_cart",
  "checkout_started",
  "purchase_completed",
  "reorder_clicked",
  "bot_interaction",
  "content_viewed",
  "inactivity_detected",
  "message_sent",
  "message_received",
  "session_start",
  "reorder_triggered",
  "page_viewed",
  "product_clicked",
  "remove_from_cart",
  "cart_viewed",
  "begin_checkout",
  "checkout_clicked",
  "checkout_viewed",
  "checkout_abandoned",
  "checkout_failed",
  "offer_shown",
  "offer_skipped",
  "upsell_accepted",
  "upsell_dismissed",
  "exit_intent_shown",
  "exit_intent_dismissed",
  "exit_intent_converted",
  "bot_started",
  "search_performed",
  "wishlist_added",
  "wishlist_removed",
  "review_submitted",
  "promo_applied",
  "promo_failed",
  "share_clicked",
  "phone_call_clicked",
  "telegram_link_clicked",
  "chat_opened",
  "chat_message_sent",
  "newsletter_signup",
  "ai_chat_product_click",
  "ai_chat_product_recommended",
  "reorder_completed",
  "app_opened",
  "deep_link_opened",
  "push_received",
  "push_opened",
  "oauth_callback_success",
  "apk_install_prompt_shown",
  "apk_install_prompt_clicked",
  "apk_install_prompt_dismissed",
  "bot_reorder_reminder_sent",
  "referral_link_copied",
  "referral_link_shared",
  "referral_clicked",
  "referral_rewarded",
];
const VALID_SET = new Set<string>(VALID_TYPES as string[]);

type IngestBody = {
  tenant_slug?: string;
  tenant_id?: string;
  type?: string;
  session_id?: string;
  product_id?: string;
  order_id?: string;
  created_at?: string;
  total_cents?: number;
  currency?: string;
  items?: Array<{
    product_id?: string;
    product_name?: string;
    quantity?: number;
    unit_price_cents?: number;
  }>;
  payload?: Record<string, unknown>;
  customer?: {
    email?: string;
    name?: string;
    telegram_chat_id?: string | number;
    telegram_username?: string;
    user_id?: string;
  };
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

const okJson = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ success: true, ...body }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });

export const Route = createFileRoute("/hooks/ingest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        let body: IngestBody;
        try {
          body = (await request.json()) as IngestBody;
        } catch {
          return jsonError("Invalid JSON", 400);
        }

        // Resolve tenant — slug preferred (avoids leaking tenant_id surface).
        let tenantId = body.tenant_id ?? null;
        if (!tenantId && body.tenant_slug) {
          const { data: t } = await supabaseAdmin
            .from("tenants")
            .select("id, status")
            .eq("slug", body.tenant_slug)
            .maybeSingle();
          if (!t || t.status !== "active") return jsonError("Unknown or inactive tenant", 404);
          tenantId = t.id;
        }
        if (!tenantId) return jsonError("Unknown tenant", 404);

        // Adaptive event-type fallback: unknown types become content_viewed
        // with the original type preserved in payload.original_type. Keeps
        // the storefront integration future-proof when we add new event
        // types client-side before they exist server-side.
        const rawType = (body.type ?? "").toString();
        let eventType: EventType;
        let typeFallback: string | null = null;
        if (VALID_SET.has(rawType)) {
          eventType = rawType as EventType;
        } else {
          eventType = "content_viewed";
          typeFallback = rawType || "unknown";
        }

        // Optional: upsert customer (idempotent by email or telegram_chat_id).
        let customerId: string | null = null;
        if (body.customer) {
          const c = body.customer;
          const tg = c.telegram_chat_id != null ? String(c.telegram_chat_id) : null;
          if (c.email) {
            const { data: existing } = await supabaseAdmin
              .from("customers")
              .select("id")
              .eq("tenant_id", tenantId)
              .ilike("email", c.email)
              .maybeSingle();
            if (existing) {
              customerId = existing.id;
              await supabaseAdmin
                .from("customers")
                .update({
                  name: c.name ?? undefined,
                  telegram_chat_id: tg ?? undefined,
                  telegram_username: c.telegram_username ?? undefined,
                  user_id: c.user_id ?? undefined,
                })
                .eq("id", existing.id);
            } else {
              const { data: ins } = await supabaseAdmin
                .from("customers")
                .insert({
                  tenant_id: tenantId,
                  email: c.email,
                  name: c.name ?? null,
                  telegram_chat_id: tg,
                  telegram_username: c.telegram_username ?? null,
                  user_id: c.user_id ?? null,
                })
                .select("id")
                .single();
              customerId = ins?.id ?? null;
            }
          } else if (tg) {
            const { data: existing } = await supabaseAdmin
              .from("customers")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("telegram_chat_id", tg)
              .maybeSingle();
            if (existing) {
              customerId = existing.id;
            } else {
              const { data: ins } = await supabaseAdmin
                .from("customers")
                .insert({
                  tenant_id: tenantId,
                  telegram_chat_id: tg,
                  telegram_username: c.telegram_username ?? null,
                  name: c.name ?? null,
                })
                .select("id")
                .single();
              customerId = ins?.id ?? null;
            }
          }
        }

        // Auto-upsert order on purchase_completed so LTV / retention agents
        // work without a separate webhook. order_id is optional — when
        // omitted, we synthesize one from session + total.
        let orderId: string | null = body.order_id ?? null;
        if (eventType === "purchase_completed" && body.total_cents) {
          if (!orderId) {
            // Fingerprint: prevents double-insert on retried beacons.
            const fingerprint = `${body.session_id ?? "anon"}:${body.total_cents}`;
            const { data: existing } = await supabaseAdmin
              .from("orders")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("payment_ref", fingerprint)
              .maybeSingle();
            orderId = existing?.id ?? null;
          }
          if (!orderId) {
            const { data: ord, error: ordErr } = await supabaseAdmin
              .from("orders")
              .insert({
                tenant_id: tenantId,
                status: "paid",
                paid_at: body.created_at ?? new Date().toISOString(),
                total_cents: body.total_cents,
                currency: (body.currency ?? "UAH").toUpperCase(),
                customer_email: body.customer?.email ?? null,
                customer_name: body.customer?.name ?? null,
                customer_user_id: body.customer?.user_id ?? null,
                payment_method: "manual",
                payment_ref: `${body.session_id ?? "anon"}:${body.total_cents}`,
                metadata: { ingest: true, source: "pixel" } as never,
              })
              .select("id")
              .single();
            if (ordErr) {
              console.error("[ingest] order insert failed", ordErr);
            }
            orderId = ord?.id ?? null;

            // Insert items if provided.
            if (orderId && Array.isArray(body.items)) {
              const itemsRows = body.items
                .filter((it) => it.product_name && (it.quantity ?? 0) > 0)
                .map((it) => ({
                  tenant_id: tenantId!,
                  order_id: orderId!,
                  product_id: it.product_id ?? null,
                  product_name: it.product_name!,
                  quantity: it.quantity ?? 1,
                  unit_price_cents: it.unit_price_cents ?? 0,
                }));
              if (itemsRows.length) {
                const { error: itErr } = await supabaseAdmin.from("order_items").insert(itemsRows);
                if (itErr) console.error("[ingest] order_items insert failed", itErr);
              }
            }
          }
        }

        const payload: Record<string, unknown> = { ...(body.payload ?? {}) };
        if (customerId) payload.customer_id = customerId;
        if (typeFallback) payload.original_type = typeFallback;
        if (body.total_cents != null) payload.total_cents = body.total_cents;
        // External user_id (from client's own auth) is preserved in payload only.
        // events.user_id has a FK to auth.users — we must NOT write external IDs there.
        if (body.customer?.user_id) payload.external_user_id = body.customer.user_id;

        const { error: evtErr } = await supabaseAdmin.from("events").insert({
          tenant_id: tenantId,
          type: eventType,
          session_id: body.session_id ?? null,
          product_id: body.product_id ?? null,
          order_id: orderId,
          user_id: null, // never use external user_id here — see comment above
          created_at: body.created_at ?? new Date().toISOString(),
          payload: payload as never,
        });
        if (evtErr) {
          console.error("[ingest] event insert failed", evtErr);
          return jsonError("Failed to log event", 500, { details: evtErr.message });
        }

        return okJson({
          customer_id: customerId,
          order_id: orderId,
          mapped_type: eventType,
          original_type: typeFallback,
        });
      },
    },
  },
});
