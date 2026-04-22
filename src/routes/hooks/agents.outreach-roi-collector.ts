/**
 * Outreach ROI Collector — JOIN events (utm_campaign LIKE 'outreach_%') + orders
 * → пише в outreach_metrics.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeOutreach, resolveTargetTenants } from "@/lib/outreach/auth";

async function runForTenant(tenantId: string) {
  const { data: actions, error } = await supabaseAdmin
    .from("outreach_actions")
    .select("id, lead_id, channel, utm_campaign, promo_code, posted_at")
    .eq("tenant_id", tenantId)
    .in("status", ["posted", "approved"])
    .limit(1000);
  if (error) throw new Error(error.message);

  const stats = { actions: 0, metrics_upserted: 0 };
  for (const a of actions ?? []) {
    stats.actions++;
    // зчитуємо події з payload (events.payload містить utm_campaign як рядок)
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("type, payload")
      .eq("tenant_id", tenantId)
      .or(
        `payload->>utm_campaign.eq.${a.utm_campaign},payload->>url.ilike.%utm_campaign=${a.utm_campaign}%`,
      )
      .limit(5000);

    let visits = 0;
    let add_to_cart = 0;
    for (const e of ev ?? []) {
      const t = String(e.type);
      if (t === "page_view" || t === "product_view") visits++;
      if (t === "add_to_cart") add_to_cart++;
    }

    let orders_count = 0;
    let revenue = 0;
    if (a.promo_code) {
      const { data: ord } = await supabaseAdmin
        .from("orders")
        .select("total_cents, status")
        .eq("tenant_id", tenantId)
        .neq("status", "cancelled");
      // фільтруємо вручну за metadata.promo_code (бо в orders немає прямого FK)
      // у MARQ promo прив'язується через promotions, тому шукаємо в metadata
      const matching = (ord ?? []).filter((o) => {
        try {
          const meta = (o as unknown as { metadata?: Record<string, unknown> }).metadata;
          return meta && (meta as Record<string, unknown>).outreach_promo_code === a.promo_code;
        } catch {
          return false;
        }
      });
      orders_count = matching.length;
      revenue = matching.reduce((s, o) => s + (Number(o.total_cents) || 0), 0) / 100;
    }

    const ctr = visits > 0 ? +(orders_count / visits).toFixed(4) : 0;
    const conversion_rate = ctr;
    const roi_per_action = revenue;

    await supabaseAdmin.from("outreach_metrics").upsert(
      {
        tenant_id: tenantId,
        action_id: a.id,
        lead_id: a.lead_id,
        channel: a.channel,
        utm_campaign: a.utm_campaign,
        impressions: 0,
        clicks: visits,
        visits,
        add_to_cart,
        orders_count,
        revenue,
        ctr,
        conversion_rate,
        roi_per_action,
        computed_at: new Date().toISOString(),
      } as never,
      { onConflict: "action_id" },
    );
    stats.metrics_upserted++;
  }
  return stats;
}

export const Route = createFileRoute("/hooks/agents/outreach-roi-collector")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request
          .clone()
          .json()
          .catch(() => ({}))) as { tenant_id?: string };
        const auth = await authorizeOutreach(request, body.tenant_id ?? null);
        if ("error" in auth) return jsonError(auth.error, auth.status);
        const tenants = await resolveTargetTenants(auth, body.tenant_id ?? null);
        const summary: Record<string, unknown> = {};
        for (const t of tenants) summary[t] = await runForTenant(t);
        return jsonOk({ tenants: tenants.length, summary });
      },
    },
  },
});
