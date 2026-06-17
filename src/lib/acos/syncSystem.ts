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
    .from("sync_jobs")
    .insert({
      tenant_id: tenantId,
      provider,
      status: "running",
      started_at: new Date().toISOString(),
      items_synced: 0,
      errors: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data as SyncJob;
}

/**
 * Завершити синхронізацію.
 */
export async function completeSync(
  jobId: string,
  itemsSynced: number,
  errors: number,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("sync_jobs")
    .update({
      status: errors > 0 ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      items_synced: itemsSynced,
      errors,
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
    .from("sync_jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as SyncJob[];
}
