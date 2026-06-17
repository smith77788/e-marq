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
import { aiChat, isAnyAiEnabled } from "@/lib/acos/aiGateway";

const AGENT_ID = "winback_engine";

async function aiOffer(opts: {
  brandName: string;
  firstName: string;
  daysSince: number;
  favoriteProduct: string | null;
  totalSpent: number;
}): Promise<string | null> {
  if (!isAnyAiEnabled()) return null;
  const sys = `You write SHORT winback messages for D2C brand "${opts.brandName}". Tone: warm, friendly, never desperate. 1-2 short sentences max. Never say "discount" — say "something on me" or "small treat". Never claim to be AI.`;
  const user = `Customer "${opts.firstName}" hasn't ordered in ${opts.daysSince} days. Lifetime value: $${(opts.totalSpent / 100).toFixed(0)}.${opts.favoriteProduct ? ` Favorite: ${opts.favoriteProduct}.` : ""} Write a personal nudge that mentions the product if known. End with a soft question.`;
  const result = await aiChat({ system: sys, user, temperature: 0.6 });
  return result.content;
}

export async function runWinbackForTenant(
  tenantId: string,
): Promise<{ queued: number; skipped: number }> {
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
  if (!candidates || candidates.length === 0) return { queued: 0, skipped: 0 };

  const { data: cfg } = await supabaseAdmin
    .from("tenant_configs")
    .select("brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const brandName = cfg?.brand_name ?? "the brand";

  // Batch: fetch all order items for all candidate emails in ONE query
  const emails = candidates.map((c) => c.email).filter(Boolean) as string[];
  const { data: allItems } = await supabaseAdmin
    .from("order_items")
    .select("product_name, quantity, orders!inner(customer_email, status)")
    .eq("tenant_id", tenantId)
    .in("orders.customer_email", emails)
    .in("orders.status", ["paid", "fulfilled"])
    .limit(500);

  // Build favorite product map per email
  const emailTally: Record<string, Record<string, number>> = {};
  for (const it of allItems ?? []) {
    const email = (it.orders as { customer_email: string })?.customer_email;
    if (!email) continue;
    if (!emailTally[email]) emailTally[email] = {};
    emailTally[email][it.product_name] = (emailTally[email][it.product_name] ?? 0) + (it.quantity ?? 1);
  }
  const favoriteMap: Record<string, string | null> = {};
  for (const email of emails) {
    const tally = emailTally[email] ?? {};
    favoriteMap[email] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  // Batch: pick channels for all candidates
  const channelMap: Record<string, string | null> = {};
  const channelPromises = candidates.map(async (c) => {
    channelMap[c.id] = await pickChannelForCustomer(c.id);
  });
  await Promise.all(channelPromises);

  // Batch: fetch avg_order_cents for all candidates
  const customerIds = candidates.map((c) => c.id);
  const { data: statsRows } = await supabaseAdmin
    .from("customers")
    .select("id, avg_order_cents")
    .in("id", customerIds);
  const statsMap: Record<string, number | null> = {};
  for (const s of statsRows ?? []) statsMap[s.id] = s.avg_order_cents ?? null;

  // Process each candidate
  let queued = 0,
    skipped = 0;
  const outboundInserts: Array<Record<string, unknown>> = [];
  const updateIds: string[] = [];

  for (const c of candidates) {
    const channel = channelMap[c.id];
    if (!channel) {
      skipped++;
      continue;
    }

    const favorite = favoriteMap[c.email ?? ""] ?? null;
    const firstName = (c.name ?? "").split(" ")[0] || "there";
    const daysSince = c.last_order_at
      ? Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000))
      : inactiveDays;

    const aiBody = await aiOffer({
      brandName,
      firstName,
      daysSince,
      favoriteProduct: favorite,
      totalSpent: c.total_spent_cents,
    });
    const body =
      aiBody ??
      `Hey ${firstName}, it's been a while! ${favorite ? `Your ${favorite} must be running low — ` : ""}can I sort you out with something nice this week?`;

    const expected = statsMap[c.id] ?? null;

    outboundInserts.push({
      tenant_id: tenantId,
      customer_id: c.id,
      channel,
      trigger_kind: "winback",
      template_key: "winback.ai.v1",
      body,
      status: "pending",
      expected_impact_cents: expected,
      metadata: { days_since_last_order: daysSince, favorite_product: favorite },
    });
    updateIds.push(c.id);
  }

  // Batch insert outbound messages
  if (outboundInserts.length > 0) {
    // Insert in chunks of 100
    for (let i = 0; i < outboundInserts.length; i += 100) {
      const chunk = outboundInserts.slice(i, i + 100);
      const { error: insErr } = await supabaseAdmin
        .from("outbound_messages")
        .insert(chunk as never);
      if (!insErr) {
        queued += chunk.length;
      } else {
        skipped += chunk.length;
      }
    }
  }

  // Batch update last_contacted_at
  if (updateIds.length > 0 && queued > 0) {
    await supabaseAdmin
      .from("customers")
      .update({ last_contacted_at: new Date().toISOString() })
      .in("id", updateIds.slice(0, queued));
  }

  return { queued, skipped };
}

export const Route = createFileRoute("/hooks/engines/winback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
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
          await finishAgentRun(handle, queued, {
            queued,
            skipped,
            sent: dispatch.sent,
            failed: dispatch.failed,
          });
          return jsonOk({ queued, skipped, sent: dispatch.sent, failed: dispatch.failed });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Winback engine failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
