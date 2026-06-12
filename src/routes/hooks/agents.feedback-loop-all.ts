/**
 * Cron entrypoint — runs feedback loop for ALL active tenants.
 * Updates outbound_messages outcomes and decision_policies.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FANOUT_TENANT_STATUSES } from "@/lib/acos/fanoutTenants";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import type { Database } from "@/integrations/supabase/types";
import { isCronToken } from "@/lib/acos/cronAuth";

async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;
  if (isCronToken(token)) return true;
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

type Outbound = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  trigger_kind: string;
  sent_at: string;
};

async function runFeedbackForTenant(
  tenantId: string,
): Promise<{ measured: number; conversions: number; revenue: number }> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("outbound_messages")
    .select("id, tenant_id, customer_id, trigger_kind, sent_at")
    .eq("tenant_id", tenantId)
    .in("status", ["sent", "replied"])
    .not("sent_at", "is", null)
    .is("converted_at", null)
    .lte("sent_at", cutoff)
    .limit(200);

  let measured = 0,
    conversions = 0,
    totalRevenue = 0;
  const policyAgg: Record<string, { trials: number; wins: number; revenue: number }> = {};

  for (const r of (rows ?? []) as Outbound[]) {
    policyAgg[r.trigger_kind] = policyAgg[r.trigger_kind] ?? { trials: 0, wins: 0, revenue: 0 };
    policyAgg[r.trigger_kind].trials++;

    if (!r.customer_id) {
      await supabaseAdmin
        .from("outbound_messages")
        .update({ actual_revenue_cents: 0 })
        .eq("id", r.id);
      measured++;
      continue;
    }

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("email")
      .eq("id", r.customer_id)
      .maybeSingle();
    const email = customer?.email ?? null;
    if (!email) {
      await supabaseAdmin
        .from("outbound_messages")
        .update({ actual_revenue_cents: 0 })
        .eq("id", r.id);
      measured++;
      continue;
    }

    const windowEnd = new Date(new Date(r.sent_at).getTime() + 7 * 24 * 3600 * 1000).toISOString();
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("tenant_id", tenantId)
      .in("status", ["paid", "fulfilled"])
      .ilike("customer_email", email)
      .gte("paid_at", r.sent_at)
      .lte("paid_at", windowEnd);
    const revenue = (orders ?? []).reduce((s, o) => s + (o.total_cents ?? 0), 0);

    await supabaseAdmin
      .from("outbound_messages")
      .update({
        actual_revenue_cents: revenue,
        status: revenue > 0 ? "converted" : undefined,
        converted_at: revenue > 0 ? new Date().toISOString() : null,
      })
      .eq("id", r.id);
    measured++;
    if (revenue > 0) {
      conversions++;
      totalRevenue += revenue;
      policyAgg[r.trigger_kind].wins++;
      policyAgg[r.trigger_kind].revenue += revenue;
    }
  }

  for (const [kind, agg] of Object.entries(policyAgg)) {
    const policyKey = `engine.${kind}.performance`;
    const { data: existing } = await supabaseAdmin
      .from("decision_policies")
      .select("id, trial_count, win_count, total_revenue_cents")
      .eq("tenant_id", tenantId)
      .eq("policy_key", policyKey)
      .eq("is_active", true)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("decision_policies")
        .update({
          trial_count: existing.trial_count + agg.trials,
          win_count: existing.win_count + agg.wins,
          total_revenue_cents: existing.total_revenue_cents + agg.revenue,
          reason: `Updated by feedback loop: ${agg.wins}/${agg.trials} wins this batch`,
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("decision_policies").insert({
        tenant_id: tenantId,
        policy_key: policyKey,
        value: { kind } as never,
        trial_count: agg.trials,
        win_count: agg.wins,
        total_revenue_cents: agg.revenue,
        reason: "Initial measurement",
      });
    }
  }

  return { measured, conversions, revenue: totalRevenue };
}

export const Route = createFileRoute("/hooks/agents/feedback-loop-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!(await isAuthorized(token))) return jsonError("Unauthorized", 401);

        const { data: tenants, error } = await supabaseAdmin
          .from("tenants")
          .select("id, slug")
          .in("status", [...FANOUT_TENANT_STATUSES]);
        if (error) return jsonError("Failed to load tenants", 500, { details: error.message });

        const outcomes: Array<Record<string, unknown>> = [];
        let totalMeasured = 0,
          totalConversions = 0,
          totalRevenue = 0;
        for (const t of tenants ?? []) {
          try {
            const r = await runFeedbackForTenant(t.id);
            totalMeasured += r.measured;
            totalConversions += r.conversions;
            totalRevenue += r.revenue;
            outcomes.push({ tenant_id: t.id, slug: t.slug, ...r });
          } catch (err) {
            outcomes.push({
              tenant_id: t.id,
              slug: t.slug,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return jsonOk({
          tenants_processed: outcomes.length,
          totals: {
            measured: totalMeasured,
            conversions: totalConversions,
            revenue_cents: totalRevenue,
          },
          outcomes,
        });
      },
    },
  },
});
