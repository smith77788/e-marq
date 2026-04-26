/**
 * Detector — too many old unread owner_notifications building up.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DetectorFn } from "../types";

export const detectStaleNotifications: DetectorFn = async ({ tenantId }) => {
  if (!tenantId) return [];
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("owner_notifications")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_read", false)
    .lt("created_at", cutoff);
  if (!count || count < 50) return [];

  return [
    {
      detector: "stale_notifications",
      tenant_id: tenantId,
      severity: "p3" as const,
      title: `${count} stale unread notifications (>14d)`,
      root_cause: "Notification queue accumulating unread items older than 14 days",
      scope: { tenant_id: tenantId, count },
      fingerprint: `stale_notifications:${tenantId}`,
      regression_risk: "low",
      proposed_actions: [
        {
          kind: "cleanup_expired_notifications",
          payload: { tenant_id: tenantId, older_than_iso: cutoff },
          reversible: false,
        },
      ],
    },
  ];
};
