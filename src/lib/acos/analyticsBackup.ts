/**
 * Smart Analytics Backup — бекап аналітичних даних.
 *
 * Що бекапиться:
 * 1. Metrics snapshots (денні)
 * 2. Insights history
 * 3. Agent runs history
 * 4. Customer segments
 * 5. Revenue reports
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AnalyticsBackup = {
  id: string;
  tenant_id: string;
  type: string;
  data: unknown;
  created_at: string;
};

/**
 * Зберегти snapshot метрик.
 */
export async function saveMetricsSnapshot(
  tenantId: string,
  metrics: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin.from("analytics_snapshots").insert({
    tenant_id: tenantId,
    type: "metrics",
    data: metrics,
  });

  return { ok: !error };
}

/**
 * Отримати історію метрик.
 */
export async function getMetricsHistory(
  tenantId: string,
  days: number = 30,
): Promise<AnalyticsBackup[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from("analytics_snapshots")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("type", "metrics")
    .gte("created_at", since)
    .order("created_at");

  return (data ?? []) as AnalyticsBackup[];
}
