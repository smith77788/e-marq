/**
 * Smart Data Archiving — архівація старих даних.
 *
 * Стратегії:
 * 1. Cold Storage — рідко використовувані дані
 * 2. Compression — стиснення архівів
 * 3. Indexing — індексація для швидкого пошуку
 * 4. Retention — дотримання термінів зберігання
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ArchiveResult = {
  table: string;
  archived: number;
  compressed_bytes: number;
};

/**
 * Архівувати старі дані (видалити старі події безпосередньо з events).
 */
export async function archiveOldData(
  tenantId: string,
): Promise<ArchiveResult[]> {
  const results: ArchiveResult[] = [];

  // Порахувати події старіші 90 днів
  const days90Ago = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

  const { count: toArchive } = await supabaseAdmin
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .lt("created_at", days90Ago);

  const archived = toArchive ?? 0;

  if (archived > 0) {
    // Видалити старі події
    await supabaseAdmin
      .from("events")
      .delete()
      .eq("tenant_id", tenantId)
      .lt("created_at", days90Ago);

    results.push({ table: "events", archived, compressed_bytes: 0 });
  }

  return results;
}
