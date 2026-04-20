/**
 * Public event ingest. ANY storefront / external script POSTs here.
 *
 * Body:
 * {
 *   tenant_slug: "acme",  // OR tenant_id
 *   tenant_id?: string,
 *   type: "product_viewed" | "add_to_cart" | "checkout_started" | "purchase_completed" | "session_start" | ...,
 *   session_id?: string,
 *   customer?: { email?, name?, telegram_chat_id?, telegram_username?, user_id? },
 *   product_id?: string,
 *   order_id?: string,
 *   payload?: Record<string, unknown>
 * }
 *
 * No auth required — designed to be called from public storefront pixels and
 * Telegram webhooks. Tenant resolution is by slug for safety (no tenant_id leak).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import type { Database } from "@/integrations/supabase/types";

type EventType = Database["public"]["Enums"]["event_type"];

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
];

type IngestBody = {
  tenant_slug?: string;
  tenant_id?: string;
  type?: string;
  session_id?: string;
  product_id?: string;
  order_id?: string;
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

        if (!body.type || !VALID_TYPES.includes(body.type as EventType)) {
          return jsonError(`Invalid event type. Allowed: ${VALID_TYPES.join(", ")}`, 400);
        }

        // Resolve tenant
        let tenantId = body.tenant_id ?? null;
        if (!tenantId && body.tenant_slug) {
          const { data: t } = await supabaseAdmin
            .from("tenants")
            .select("id")
            .eq("slug", body.tenant_slug)
            .maybeSingle();
          tenantId = t?.id ?? null;
        }
        if (!tenantId) return jsonError("Unknown tenant", 404);

        // Optional: upsert customer
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

        const payload: Record<string, unknown> = { ...(body.payload ?? {}) };
        if (customerId) payload.customer_id = customerId;

        const { error: evtErr } = await supabaseAdmin.from("events").insert({
          tenant_id: tenantId,
          type: body.type as EventType,
          session_id: body.session_id ?? null,
          product_id: body.product_id ?? null,
          order_id: body.order_id ?? null,
          user_id: body.customer?.user_id ?? null,
          payload: payload as never,
        });
        if (evtErr) return jsonError("Failed to log event", 500, { details: evtErr.message });

        return new Response(JSON.stringify({ success: true, customer_id: customerId }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      },
    },
  },
});
