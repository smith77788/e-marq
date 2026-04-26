/**
 * Detector — transient outreach failures that can be rescheduled.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DetectorFn } from "../types";

const PERMANENT_PATTERNS = [
  "rate_limit_exceeded",
  "token_invalid",
  "auth_failed",
  "banned",
  "deleted_by_moderator",
  "permanent_block",
  "spam_detected",
];

export const detectOutreachFailures: DetectorFn = async ({ tenantId }) => {
  if (!tenantId) return [];
  const since6h = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

  const { data: failed } = await supabaseAdmin
    .from("outreach_actions")
    .select("id, channel, retry_count, failed_reason")
    .eq("tenant_id", tenantId)
    .eq("status", "failed")
    .gte("created_at", since6h)
    .lt("retry_count", 3)
    .limit(200);

  if (!failed || failed.length === 0) return [];

  const transient = failed.filter((a) => {
    const r = (a.failed_reason ?? "").toLowerCase();
    return !PERMANENT_PATTERNS.some((p) => r.includes(p));
  });

  if (transient.length === 0) return [];

  const ids = transient.map((a) => a.id);
  return [
    {
      detector: "outreach_failures",
      tenant_id: tenantId,
      severity: transient.length > 20 ? "p1" : "p2",
      title: `${transient.length} transient outreach failures`,
      root_cause: "Outreach actions failed with retryable reasons (network/timeout/etc.)",
      scope: { tenant_id: tenantId, count: transient.length, channels: [...new Set(transient.map((t) => t.channel))] },
      fingerprint: `outreach_failures:${tenantId}`,
      regression_risk: "low",
      proposed_actions: [
        {
          kind: "reschedule_outreach",
          payload: { tenant_id: tenantId, action_ids: ids },
          reversible: true,
          revert_payload: { action_ids: ids, restore_status: "failed" },
        },
      ],
    },
  ];
};
