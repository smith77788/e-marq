/**
 * Smart Sync System — централізована система синхронізації даних.
 *
 * Джерела:
 * 1. Shopify — OAuth синхронізація
 * 2. WooCommerce — REST API синхронізація
 * 3. CSV — ручна синхронізація
 * 4. Webhook — реальний час
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SyncJob = {
  id: string;
  provider: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at?: string;
  completed_at?: string;
  items_synced: number;
  errors: number;
};

/**
 * Запустити синхронізацію.
 */
export async function startSync(
  tenantId: string,
  provider: string,
): Promise<SyncJob> {
  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `sync_${tenantId}_${provider}_${Date.now()}`,
      fact_kind: "sync_job",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "sync_system",
      value: {
        provider,
        status: "running",
        started_at: new Date().toISOString(),
        items_synced: 0,
        errors: 0,
      } as never,
    })
    .select()
    .single();

  if (error) throw error;

  const v = (data.value ?? {}) as Record<string, unknown>;
  return {
    id: data.id,
    provider: (v.provider as string) ?? provider,
    status: "running",
    started_at: (v.started_at as string),
    items_synced: 0,
    errors: 0,
  };
}

/**
 * Завершити синхронізацію.
 */
export async function completeSync(
  jobId: string,
  itemsSynced: number,
  errors: number,
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", jobId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({
      value: {
        ...v,
        status: errors > 0 ? "failed" : "completed",
        completed_at: new Date().toISOString(),
        items_synced: itemsSynced,
        errors,
      } as never,
    })
    .eq("id", jobId);

  return { ok: !error };
}

/**
 * Отримати історію синхронізацій.
 */
export async function getSyncHistory(
  tenantId: string,
  limit: number = 10,
): Promise<SyncJob[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "sync_job")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      provider: (v.provider as string) ?? "",
      status: (v.status as SyncJob["status"]) ?? "pending",
      started_at: v.started_at as string | undefined,
      completed_at: v.completed_at as string | undefined,
      items_synced: (v.items_synced as number) ?? 0,
      errors: (v.errors as number) ?? 0,
    } satisfies SyncJob;
  });
}
