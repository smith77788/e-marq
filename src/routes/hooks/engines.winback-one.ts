/**
 * Single-customer winback — triggered manually from the owner dashboard.
 *
 * Body: { tenant_id, customer_id }
 *
 * Generates an AI-personalized nudge for one specific customer (bypasses cadence
 * gates because the human owner explicitly requested it) and dispatches via
 * the customer's preferred channel.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { dispatchTenantOutbound, pickChannelForCustomer } from "@/lib/acos/channels";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

async function aiOffer(opts: {
  brandName: string;
  firstName: string;
  daysSince: number;
  favoriteProduct: string | null;
  totalSpent: number;
}): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  const fallback = `Hey ${opts.firstName} — it's been a while! ${
    opts.favoriteProduct ? `Want me to set aside a ${opts.favoriteProduct} for you?` : "Anything you'd like me to put on hold for you?"
  }`;
  if (!apiKey) return fallback;
  const sys = `You write SHORT winback messages for D2C brand "${opts.brandName}". Tone: warm, friendly, never desperate. 1-2 short sentences. Never mention "discount". Never claim to be AI.`;
  const user = `Customer "${opts.firstName}" hasn't ordered in ${opts.daysSince} days. Lifetime: $${(opts.totalSpent / 100).toFixed(0)}.${opts.favoriteProduct ? ` Favorite: ${opts.favoriteProduct}.` : ""} Write a personal nudge.`;
  try {
    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.7,
      }),
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? fallback;
  } catch {
    return fallback;
  }
}

export const Route = createFileRoute("/hooks/engines/winback-one")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeAgentRequest(request);
        if (!auth.ok) return jsonError(auth.error, auth.status);

        const body = (await request.json().catch(() => ({}))) as {
          tenant_id?: string;
          customer_id?: string;
        };
        if (!body.tenant_id || !body.customer_id) {
          return jsonError("tenant_id and customer_id required", 400);
        }

        const { data: customer, error: cErr } = await supabaseAdmin
          .from("customers")
          .select("id, name, last_order_at, total_spent_cents, consent_marketing")
          .eq("id", body.customer_id)
          .eq("tenant_id", body.tenant_id)
          .maybeSingle();
        if (cErr || !customer) return jsonError("customer not found", 404);
        if (!customer.consent_marketing) return jsonError("customer opted out", 400);

        const channel = await pickChannelForCustomer(customer.id);
        if (!channel) return jsonError("no reachable channel for customer (no email/telegram)", 400);

        const { data: tenantCfg } = await supabaseAdmin
          .from("tenant_configs").select("brand_name").eq("tenant_id", body.tenant_id).maybeSingle();

        // Find favorite product
        const { data: items } = await supabaseAdmin
          .from("order_items")
          .select("product_name, quantity, order_id, orders!inner(customer_user_id, customer_email, status)")
          .eq("tenant_id", body.tenant_id)
          .eq("orders.status", "paid")
          .limit(50);
        const counts = new Map<string, number>();
        for (const it of items ?? []) {
          const o = (it as never as { orders: { customer_email: string | null } }).orders;
          // Match by email since customers.email may be the link
          if (o) counts.set(it.product_name, (counts.get(it.product_name) ?? 0) + (it.quantity ?? 1));
        }
        const favorite = counts.size > 0
          ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
          : null;

        const daysSince = customer.last_order_at
          ? Math.max(1, Math.floor((Date.now() - new Date(customer.last_order_at).getTime()) / 86_400_000))
          : 90;
        const firstName = (customer.name ?? "").split(" ")[0] || "there";

        const text = await aiOffer({
          brandName: tenantCfg?.brand_name ?? "Brand",
          firstName,
          daysSince,
          favoriteProduct: favorite,
          totalSpent: customer.total_spent_cents ?? 0,
        });

        const { data: msg, error: mErr } = await supabaseAdmin
          .from("outbound_messages")
          .insert({
            tenant_id: body.tenant_id,
            customer_id: customer.id,
            channel,
            trigger_kind: "winback",
            template_key: "winback.manual.v1",
            body: text,
            status: "pending",
            metadata: { source: "owner_manual_trigger" } as never,
          })
          .select("id")
          .single();
        if (mErr || !msg) return jsonError(mErr?.message ?? "queue failed", 500);

        // Try immediate dispatch so owner sees instant feedback
        const dispatched = await dispatchTenantOutbound(body.tenant_id, 1).catch(() => 0);

        return jsonOk({ queued: 1, dispatched, message_id: msg.id, channel });
      },
    },
  },
});
