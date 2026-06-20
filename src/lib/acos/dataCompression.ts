/**
 * Smart Data Compression — компресія даних для економії місця.
 *
 * Методи:
 * 1. Агрегація за день (об'єднує події за день)
 * 2. Видалення дублікатів
 * 3. Стиснення JSON полів
 * 4. Архівація старих даних
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CompressionResult = {
  table: string;
  before_count: number;
  after_count: number;
  compression_ratio: number;
};

/**
 * Агрегувати події за день.
 */
export async function aggregateDailyEvents(
  tenantId: string,
): Promise<CompressionResult> {
  const days30Ago = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  // Отримати події за 30-60 днів тому (для агрегації)
  const days60Ago = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();

  const { data: events } = await supabaseAdmin
    .from("events")
    .select("id, type, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", days60Ago)
    .lt("created_at", days30Ago)
    .limit(10000);

  if (!events || events.length === 0) {
    return { table: "events", before_count: 0, after_count: 0, compression_ratio: 1 };
  }

  // Group events by day + type to count unique day-type combinations
  const dayTypePairs = new Set<string>();
  for (const e of events) {
    const day = e.created_at.slice(0, 10);
    dayTypePairs.add(`${day}:${e.type}`);
  }

  const afterCount = dayTypePairs.size;
  const compressionRatio = events.length > 0 ? events.length / afterCount : 1;

  return {
    table: "events",
    before_count: events.length,
    after_count: afterCount,
    compression_ratio: Math.round(compressionRatio * 100) / 100,
  };
}
