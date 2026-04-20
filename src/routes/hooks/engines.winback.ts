/**
 * Winback engine — autonomous.
 *
 * Targets customers in `at_risk` or quiet stage:
 *   - last_order_at older than 60 days
 *   - total_orders >= 1
 *   - last_contacted_at older than 30 days (or null)
 *
 * Generates a personal AI offer referencing their favorite product.
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

const AGENT_ID = "winback_engine";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

async function aiOffer(opts: {
  brandName: string;
  firstName: string;
  daysSince: number;
  favoriteProduct: string | null;
  totalSpent: number;
}): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const sys = `You write SHORT winback messages for D2C brand "${opts.brandName}". Tone: warm, friendly, never desperate. 1-2 short sentences max. Never say "discount" — say "something on me" or "small treat". Never claim to be AI.`;
  const user = `Customer "${opts.firstName}" hasn't ordered in ${opts.daysSince} days. Lifetime value: $${(opts.totalSpent / 100).toFixed(0)}.${opts.favoriteProduct ? ` Favorite: ${opts.favoriteProduct}.` : ""} Write a personal nudge that mentions the product if known. End with a soft question.`;
  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.6,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  const out = json.choices?.[0]?.message?.content?.trim();
  return out && out.length > 0 ? out : null;
}

export async function runWinbackForTenant(tenantId: string): Promise<{ queued: number; skipped: number }> {
  const cadence = await getCadenceMultiplier(tenantId, "winback");
  const inactiveDays = 60;
  const cooldownDays = 30 * cadence;

  const inactiveCutoff = new Date(Date.now() - inactiveDays * 24 * 3600 * 1000).toISOString();
  const cooldownCutoff = new Date(Date.now() - cooldownDays * 24 * 3600 * 1000).toISOString();

  const { data: candidates, error } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, total_spent_cents, last_order_at, last_contacted_at")
    .eq("tenant_id", tenantId)
    .eq("consent_marketing", true)
    .gte("total_orders", 1)
    .lte("last_order_at", inactiveCutoff)
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${cooldownCutoff}`)
    .order("total_spent_cents", { ascending: false })
    .limit(50);
  if (error) throw error;

  const { data: cfg } = await supabaseAdmin
    .from("tenant_configs")
    .select("brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const brandName = cfg?.brand_name ?? "the brand";

  let queued = 0, skipped = 0;
  for (const c of candidates ?? []) {
    const channel = await pickChannelForCustomer(c.id);
    if (!channel) { skipped++; continue; }

    // Find favorite product (most-bought)
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("product_name, quantity, orders!inner(customer_email, status)")
      .eq("tenant_id", tenantId)
      .eq("orders.customer_email", c.email ?? "")
      .eq("orders.status", "paid")
      .limit(50);
    const tally: Record<string, number> = {};
    for (const it of items ?? []) tally[it.product_name] = (tally[it.product_name] ?? 0) + (it.quantity ?? 1);
    const favorite = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const firstName = (c.name ?? "").split(" ")[0] || "there";
    const daysSince = c.last_order_at ? Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000)) : inactiveDays;

    const aiBody = await aiOffer({
      brandName,
      firstName,
      daysSince,
      favoriteProduct: favorite,
      totalSpent: c.total_spent_cents,
    });
    const body = aiBody ?? `Hey ${firstName}, it's been a while! ${favorite ? `Your ${favorite} must be running low — ` : ""}can I sort you out with something nice this week?`;

    // Expected impact = average historical AOV
    const { data: stats } = await supabaseAdmin.from("customers").select("total_orders, avg_order_cents").eq("id", c.id).maybeSingle();
    const expected = stats?.avg_order_cents ?? null;

    const { error: insErr } = await supabaseAdmin.from("outbound_messages").insert({
      tenant_id: tenantId,
      customer_id: c.id,
      channel,
      trigger_kind: "winback",
      template_key: "winback.ai.v1",
      body,
      status: "pending",
      expected_impact_cents: expected,
      metadata: { days_since_last_order: daysSince, favorite_product: favorite } as never,
    });
    if (!insErr) {
      queued++;
      await supabaseAdmin.from("customers").update({ last_contacted_at: new Date().toISOString() }).eq("id", c.id);
    } else {
      skipped++;
    }
  }
  return { queued, skipped };
}

async function tally_count(customerId: string): Promise<number> {
  const { data } = await supabaseAdmin.from("customers").select("total_orders").eq("id", customerId).maybeSingle();
  return data?.total_orders ?? 1;
}

export const Route = createFileRoute("/hooks/engines/winback")({
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
          const { queued, skipped } = await runWinbackForTenant(tenantId);
          const dispatch = await dispatchTenantOutbound(tenantId, 100);
          await finishAgentRun(handle, queued, { queued, skipped, sent: dispatch.sent, failed: dispatch.failed });
          return jsonOk({ queued, skipped, sent: dispatch.sent, failed: dispatch.failed });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Winback engine failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
