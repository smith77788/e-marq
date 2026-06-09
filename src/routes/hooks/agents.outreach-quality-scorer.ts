/**
 * Outreach Quality Scorer — перебирає posted/approved actions віком 24h–14d,
 * робить attribution через outreach_metrics і записує патерни в ai_memory.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeOutreach, resolveTargetTenants } from "@/lib/outreach/auth";
import {
  recordPattern,
  patternKey,
  bucketLength,
  bucketTone,
  ruleForPattern,
} from "@/lib/outreach/memory";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function runForTenant(tenantId: string) {
  const stats = {
    scanned: 0,
    success: 0,
    failure: 0,
    deferred: 0,
    patterns_recorded: 0,
    errors: 0,
  };
  const minAge = new Date(Date.now() - 24 * 3600_000).toISOString();
  const maxAge = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();

  const { data: actions, error } = await supabaseAdmin
    .from("outreach_actions")
    .select("id, channel, draft_text, posted_at, posted_url, status, created_at")
    .eq("tenant_id", tenantId)
    .in("status", ["posted", "approved"])
    .gte("created_at", maxAge)
    .lte("created_at", minAge)
    .limit(200);
  if (error) throw new Error(error.message);

  const ids = (actions ?? []).map((a) => a.id);
  type MetricRow = {
    action_id: string;
    clicks: number | null;
    orders_count: number | null;
    revenue: number | null;
  };
  let metrics: Record<string, MetricRow> = {};
  if (ids.length) {
    const { data: m } = await supabaseAdmin
      .from("outreach_metrics")
      .select("action_id, clicks, orders_count, revenue")
      .eq("tenant_id", tenantId)
      .in("action_id", ids);
    metrics = Object.fromEntries(((m ?? []) as MetricRow[]).map((r) => [r.action_id, r]));
  }

  for (const a of actions ?? []) {
    stats.scanned++;
    const m = metrics[a.id];
    const clicks = m?.clicks ?? 0;
    const orders = m?.orders_count ?? 0;
    const revenue = Number(m?.revenue ?? 0);
    const ageH = (Date.now() - new Date(a.posted_at ?? a.created_at).getTime()) / 3600_000;

    let outcome: "success" | "failure" | null = null;
    if (orders >= 1 || clicks >= 3) outcome = "success";
    else if (clicks === 0 && ageH >= 72) outcome = "failure";
    else {
      stats.deferred++;
      continue;
    }

    if (outcome === "success") stats.success++;
    else stats.failure++;
    const lengthBucket = bucketLength(a.draft_text);
    const toneBucket = bucketTone(a.draft_text);
    const sourceHost = hostOf(a.posted_url);
    const evidence = { action_id: a.id, clicks, orders, revenue, age_hours: Math.round(ageH) };

    const updates = [
      recordPattern({
        tenant_id: tenantId,
        pattern_key: patternKey(a.channel, "length", lengthBucket),
        category: "channel-tactics",
        learned_rule: ruleForPattern(a.channel, "length", lengthBucket, outcome),
        outcome,
        impact: revenue,
        evidence,
      }),
      recordPattern({
        tenant_id: tenantId,
        pattern_key: patternKey(a.channel, "tone", toneBucket),
        category: "channel-tactics",
        learned_rule: ruleForPattern(a.channel, "tone", toneBucket, outcome),
        outcome,
        impact: revenue,
        evidence,
      }),
    ];
    if (sourceHost) {
      updates.push(
        recordPattern({
          tenant_id: tenantId,
          pattern_key: patternKey(a.channel, "source", sourceHost),
          category: "source-quality",
          learned_rule: ruleForPattern(a.channel, "source", sourceHost, outcome),
          outcome,
          impact: revenue,
          evidence,
        }),
      );
    }
    try {
      await Promise.all(updates);
      stats.patterns_recorded += updates.length;
    } catch {
      stats.errors++;
    }
  }
  return stats;
}

export const Route = createFileRoute("/hooks/agents/outreach-quality-scorer")({
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
