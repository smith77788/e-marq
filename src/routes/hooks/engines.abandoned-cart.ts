/**
 * Abandoned Cart engine — autonomous.
 *
 * Looks for `checkout_started` events in the past 24h with no matching
 * `purchase_completed` event for the same session_id, and queues a recovery
 * message to the customer (via Telegram or Email).
 *
 * Cooldown: 1 cart-recovery message per customer per 48h.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  jsonError,
  jsonOk,
  startAgentRun,
  finishAgentRun,
  failAgentRun,
} from "@/lib/acos/agentRuntime";
import { dispatchTenantOutbound, pickChannelForCustomer } from "@/lib/acos/channels";
import { getCadenceMultiplier } from "@/lib/acos/policyTuning";

const AGENT_ID = "abandoned_cart_engine";

type CheckoutEvent = {
  id: string;
  session_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export async function runAbandonedCartForTenant(tenantId: string): Promise<{ queued: number; skipped: number }> {
  // Window: events between 30min and 24h old (give checkout 30min to complete naturally)
  const minAgeMs = 30 * 60 * 1000;
  const maxAgeMs = 24 * 3600 * 1000;
  const now = Date.now();
  const fromIso = new Date(now - maxAgeMs).toISOString();
  const toIso = new Date(now - minAgeMs).toISOString();

  const { data: starts, error } = await supabaseAdmin
    .from("events")
    .select("id, session_id, user_id, payload, created_at")
    .eq("tenant_id", tenantId)
    .eq("type", "checkout_started")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  if (!starts || starts.length === 0) return { queued: 0, skipped: 0 };

  // Pull all completions in same window for fast dedup
  const { data: completions } = await supabaseAdmin
    .from("events")
    .select("session_id, user_id")
    .eq("tenant_id", tenantId)
    .eq("type", "purchase_completed")
    .gte("created_at", fromIso);
  const completedSessions = new Set<string>();
  const completedUsers = new Set<string>();
  for (const c of completions ?? []) {
    if (c.session_id) completedSessions.add(c.session_id);
    if (c.user_id) completedUsers.add(c.user_id);
  }

  const cadence = await getCadenceMultiplier(tenantId, "abandoned_cart");
  const cooldownMs = 48 * 3600 * 1000 * cadence;
  const cooldownIso = new Date(now - cooldownMs).toISOString();

  // Dedup per customer in this batch
  const seenCustomers = new Set<string>();
  let queued = 0, skipped = 0;
  for (const ev of starts as CheckoutEvent[]) {
    if (ev.session_id && completedSessions.has(ev.session_id)) { skipped++; continue; }
    if (ev.user_id && completedUsers.has(ev.user_id)) { skipped++; continue; }

    // Find a customer record. Prefer payload.email/customer_id, fallback user_id.
    const payload = ev.payload as { email?: string; customer_id?: string; cart_value_cents?: number; product_names?: string[] };
    let customerId: string | null = payload.customer_id ?? null;
    if (!customerId && payload.email) {
      const { data: c } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("email", payload.email)
        .maybeSingle();
      customerId = c?.id ?? null;
    }
    if (!customerId && ev.user_id) {
      const { data: c } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", ev.user_id)
        .maybeSingle();
      customerId = c?.id ?? null;
    }
    if (!customerId) { skipped++; continue; }
    if (seenCustomers.has(customerId)) { skipped++; continue; }
    seenCustomers.add(customerId);

    // Cooldown: did we already cart-recover this customer recently?
    const { data: recent } = await supabaseAdmin
      .from("outbound_messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("trigger_kind", "abandoned_cart")
      .gte("created_at", cooldownIso)
      .limit(1);
    if (recent && recent.length > 0) { skipped++; continue; }

    const channel = await pickChannelForCustomer(customerId);
    if (!channel) { skipped++; continue; }

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("name, avg_order_cents")
      .eq("id", customerId)
      .maybeSingle();

    const firstName = (customer?.name ?? "").split(" ")[0] || "there";
    const productHint = (payload.product_names ?? []).slice(0, 2).join(", ");
    const body = productHint
      ? `Hey ${firstName} — noticed you left <b>${productHint}</b> in your cart. Want me to help you finish that order? 🛒`
      : `Hey ${firstName} — looks like your cart is still waiting. Want me to help you wrap it up? 🛒`;

    const expected = payload.cart_value_cents ?? customer?.avg_order_cents ?? null;

    const { error: insErr } = await supabaseAdmin.from("outbound_messages").insert({
      tenant_id: tenantId,
      customer_id: customerId,
      channel,
      trigger_kind: "abandoned_cart",
      template_key: "cart.v1",
      body,
      status: "pending",
      expected_impact_cents: expected,
      metadata: { source_event: ev.id, cart_value_cents: payload.cart_value_cents } as never,
    });
    if (!insErr) {
      queued++;
      await supabaseAdmin.from("customers").update({ last_contacted_at: new Date().toISOString() }).eq("id", customerId);
    } else {
      skipped++;
    }
  }

  return { queued, skipped };
}

export const Route = createFileRoute("/hooks/engines/abandoned-cart")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json()) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const { queued, skipped } = await runAbandonedCartForTenant(tenantId);
          const dispatch = await dispatchTenantOutbound(tenantId, 100);
          await finishAgentRun(handle, queued, {
            queued, skipped, sent: dispatch.sent, failed: dispatch.failed,
          });
          return jsonOk({ queued, skipped, sent: dispatch.sent, failed: dispatch.failed });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Abandoned cart engine failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
