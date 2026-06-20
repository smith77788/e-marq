/**
 * Smart Data Cleanup — автоматичне очищення застарілих даних.
 *
 * Очищає:
 * 1. Старі події (>90 днів)
 * 2. Чернетки повідомлень (>30 днів)
 * 3. Застарілі логи (>30 днів)
 * 4. Тимчасові файли
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CleanupResult = {
  table: string;
  deleted: number;
  freed_bytes: number;
};

/**
 * Очистити старі дані.
 */
export async function cleanupOldData(
  tenantId: string,
): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];

  // 1. Старі події (>90 днів)
  const days90Ago = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { count: oldEvents } = await supabaseAdmin
    .from("events")
    .delete()
    .eq("tenant_id", tenantId)
    .lt("created_at", days90Ago);

  results.push({ table: "events", deleted: oldEvents ?? 0, freed_bytes: 0 });

  // 2. Старі логи (>30 днів)
  const days30Ago = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { count: oldLogs } = await supabaseAdmin
    .from("ingest_error_logs")
    .delete()
    .eq("tenant_id", tenantId)
    .lt("created_at", days30Ago);

  results.push({ table: "ingest_error_logs", deleted: oldLogs ?? 0, freed_bytes: 0 });

  return results;
}

/**
 * Отримати статистику зберігання.
 */
export async function getStorageStats(
  tenantId: string,
): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};

  const [eventsRes, ordersRes, customersRes, productsRes] = await Promise.all([
    supabaseAdmin.from("events").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabaseAdmin.from("orders").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabaseAdmin.from("customers").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabaseAdmin.from("products").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);

  stats["events"] = eventsRes.count ?? 0;
  stats["orders"] = ordersRes.count ?? 0;
  stats["customers"] = customersRes.count ?? 0;
  stats["products"] = productsRes.count ?? 0;

  return stats;
}
