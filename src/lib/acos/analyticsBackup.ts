/**
 * Smart Analytics Backup — бекап аналітичних даних.
 *
 * Зберігає snapshots у таблиці bootstrap_facts (fact_kind: "analytics_snapshot").
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
  const day = new Date().toISOString().slice(0, 10);
  const snapshotKey = `analytics_snapshot:${tenantId}:${day}`;

  const { error } = await supabaseAdmin.from("bootstrap_facts").upsert(
    {
      fact_key: snapshotKey,
      fact_kind: "analytics_snapshot",
      tenant_id: tenantId,
      value: {
        type: "metrics",
        data: metrics,
        saved_at: new Date().toISOString(),
      } as never,
    },
    { onConflict: "fact_key" },
  );

  return { ok: !error };
}

/**
 * Отримати історію метрик.
 */
export async function getMetricsHistory(
  tenantId: string,
  days: number = 30,
): Promise<AnalyticsBackup[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("fact_key, tenant_id, value, updated_at")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "analytics_snapshot")
    .order("updated_at", { ascending: false })
    .limit(days + 5);

  return (data ?? [])
    .filter((row) => {
      const v = (row.value ?? {}) as Record<string, unknown>;
      return new Date((v.saved_at as string) ?? row.updated_at) >= since;
    })
    .map((row) => {
      const v = (row.value ?? {}) as Record<string, unknown>;
      return {
        id: row.fact_key ?? "",
        tenant_id: row.tenant_id ?? tenantId,
        type: "metrics",
        data: v.data,
        created_at: (v.saved_at as string) ?? row.updated_at,
      } satisfies AnalyticsBackup;
    });
}
