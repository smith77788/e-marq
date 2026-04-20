/**
 * Cron entrypoint — runs reorder engine for ALL active tenants.
 *
 * Auth: requires bearer = SUPABASE_PUBLISHABLE_KEY (cron) OR a super_admin user JWT.
 * Body: optional { dry_run?: boolean }
 *
 * Iterates active tenants, calls dispatchTenantOutbound + reorder logic per tenant,
 * aggregates totals. Designed to be hit once per day by an external cron / pg_cron.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { dispatchTenantOutbound } from "@/lib/acos/channels";
import type { Database } from "@/integrations/supabase/types";

async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;
  if (token === process.env.SUPABASE_PUBLISHABLE_KEY) return true;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return false;
  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data } = await sb.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (!userId) return false;
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  return (roles ?? []).length > 0;
}

type TenantOutcome = {
  tenant_id: string;
  tenant_slug: string;
  queued: number;
  sent: number;
  failed: number;
  error?: string;
};

async function runReorderForTenant(tenantId: string): Promise<{ queued: number }> {
  const cutoff = new Date().toISOString();
  const recentlyContactedCutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

  const { data: candidates, error } = await supabaseAdmin
    .from("customers")
    .select("id, email, name, telegram_chat_id, total_orders, avg_order_cents, predicted_next_order_at, last_contacted_at")
    .eq("tenant_id", tenantId)
    .gte("total_orders", 2)
    .eq("consent_marketing", true)
    .not("predicted_next_order_at", "is", null)
    .lte("predicted_next_order_at", cutoff)
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${recentlyContactedCutoff}`)
    .limit(200);
  if (error) throw error;

  let queued = 0;
  for (const c of candidates ?? []) {
    if (!c.telegram_chat_id) continue;

    const { data: lastItems } = await supabaseAdmin
      .from("order_items")
      .select("product_name, product_id, orders!inner(customer_email, status)")
      .eq("tenant_id", tenantId)
      .eq("orders.customer_email", c.email ?? "")
      .eq("orders.status", "paid")
      .order("created_at", { ascending: false })
      .limit(1);
    const productName = lastItems?.[0]?.product_name ?? "your favorite";
    const productId = lastItems?.[0]?.product_id ?? null;
    const firstName = (c.name ?? "").split(" ")[0] || "there";
    const body = `Hey ${firstName} 👋\n\nIt's about time to restock <b>${productName}</b>. Want me to set up your reorder?`;

    const { error: insErr } = await supabaseAdmin.from("outbound_messages").insert({
      tenant_id: tenantId,
      customer_id: c.id,
      channel: "telegram",
      trigger_kind: "reorder",
      template_key: "reorder.v1",
      body,
      status: "pending",
      related_product_id: productId,
      expected_impact_cents: c.avg_order_cents || null,
      metadata: { predicted_next_order_at: c.predicted_next_order_at } as never,
    });
    if (!insErr) {
      queued++;
      await supabaseAdmin
        .from("customers")
        .update({ last_contacted_at: new Date().toISOString() })
        .eq("id", c.id);
      await supabaseAdmin.from("events").insert({
        tenant_id: tenantId,
        type: "reorder_triggered",
        payload: { customer_id: c.id, product_id: productId } as never,
      });
    }
  }
  return { queued };
}

export const Route = createFileRoute("/hooks/engines/reorder-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!(await isAuthorized(token))) return jsonError("Unauthorized", 401);

        const { data: tenants, error } = await supabaseAdmin
          .from("tenants")
          .select("id, slug")
          .eq("status", "active");
        if (error) return jsonError("Failed to load tenants", 500, { details: error.message });

        const outcomes: TenantOutcome[] = [];
        for (const t of tenants ?? []) {
          try {
            const { queued } = await runReorderForTenant(t.id);
            const dispatch = await dispatchTenantOutbound(t.id, 100);
            outcomes.push({
              tenant_id: t.id,
              tenant_slug: t.slug,
              queued,
              sent: dispatch.sent,
              failed: dispatch.failed,
            });
          } catch (err) {
            outcomes.push({
              tenant_id: t.id,
              tenant_slug: t.slug,
              queued: 0,
              sent: 0,
              failed: 0,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const totals = outcomes.reduce(
          (acc, o) => ({
            queued: acc.queued + o.queued,
            sent: acc.sent + o.sent,
            failed: acc.failed + o.failed,
          }),
          { queued: 0, sent: 0, failed: 0 },
        );

        return jsonOk({ tenants_processed: outcomes.length, totals, outcomes });
      },
    },
  },
});
