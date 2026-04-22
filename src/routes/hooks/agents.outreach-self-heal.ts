/**
 * Outreach Self-Heal — переплановує transient-фейли, авто-вимикає поганий канал.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeOutreach, resolveTargetTenants } from "@/lib/outreach/auth";

const PERMANENT_PATTERNS = [
  "rate_limit_exceeded",
  "token_invalid",
  "auth_failed",
  "banned",
  "deleted_by_moderator",
  "permanent_block",
  "spam_detected",
  "guard_reject",
];
const CHANNELS = ["reddit", "google", "telegram", "instagram"] as const;

async function runForTenant(tenantId: string) {
  const stats = { rescheduled: 0, channels_paused: 0, examined: 0, skipped_permanent: 0 };

  // 1. Reschedule transient failures
  const since6h = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: failed } = await supabaseAdmin
    .from("outreach_actions")
    .select("id, channel, retry_count, failed_reason")
    .eq("tenant_id", tenantId)
    .eq("status", "failed")
    .gte("created_at", since6h)
    .lt("retry_count", 3)
    .limit(100);

  for (const a of failed ?? []) {
    stats.examined++;
    const reason = (a.failed_reason ?? "").toLowerCase();
    const isPermanent = PERMANENT_PATTERNS.some((p) => reason.includes(p));
    if (isPermanent) {
      stats.skipped_permanent++;
      continue;
    }
    const next = new Date(Date.now() + 15 * 60_000).toISOString();
    const { error } = await supabaseAdmin
      .from("outreach_actions")
      .update({
        status: "pending_review",
        scheduled_for: next,
        retry_count: (a.retry_count ?? 0) + 1,
      } as never)
      .eq("id", a.id);
    if (!error) stats.rescheduled++;
  }

  // 2. Auto-pause unhealthy channels
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  for (const ch of CHANNELS) {
    const [{ count: failedCnt }, { count: postedCnt }] = await Promise.all([
      supabaseAdmin
        .from("outreach_actions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("channel", ch)
        .eq("status", "failed")
        .gte("created_at", since24h),
      supabaseAdmin
        .from("outreach_actions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("channel", ch)
        .eq("status", "posted")
        .gte("created_at", since24h),
    ]);
    const f = failedCnt ?? 0;
    const p = postedCnt ?? 0;
    if (f >= 5 && p < 2) {
      const settingKey = `${ch}_posting_enabled`;
      const { data: setting } = await supabaseAdmin
        .from("outreach_settings")
        .select("value")
        .eq("tenant_id", tenantId)
        .eq("key", settingKey)
        .maybeSingle();
      const currentlyEnabled = (setting?.value as boolean) ?? false;
      if (currentlyEnabled) {
        await supabaseAdmin.from("outreach_settings").upsert(
          {
            tenant_id: tenantId,
            key: settingKey,
            value: false as never,
            description: `Auto-paused by self-heal (${f} failed / ${p} posted in 24h)`,
          } as never,
          { onConflict: "tenant_id,key" },
        );
        stats.channels_paused++;
      }
    }
  }
  return stats;
}

export const Route = createFileRoute("/hooks/agents/outreach-self-heal")({
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
