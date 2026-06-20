/**
 * Smart Data Lifecycle — управління життєвим циклом даних.
 *
 * Етапи:
 * 1. Collection — збір
 * 2. Processing — обробка
 * 3. Storage — зберігання
 * 4. Analysis — аналіз
 * 5. Archival — архівація
 * 6. Deletion — видалення
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LifecycleStage = {
  stage: string;
  records: number;
  oldest: string;
  newest: string;
};

/**
 * Отримати стан життєвого циклу даних.
 */
export async function getDataLifecycle(
  tenantId: string,
): Promise<LifecycleStage[]> {
  const stages: LifecycleStage[] = [];

  // Events — recent vs old
  const [recentEvents, oldEvents] = await Promise.all([
    supabaseAdmin.from("events").select("created_at").eq("tenant_id", tenantId).gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()).order("created_at", { ascending: false }).limit(1),
    supabaseAdmin.from("events").select("created_at").eq("tenant_id", tenantId).lt("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()).order("created_at", { ascending: true }).limit(1),
  ]);

  stages.push({
    stage: "Recent Events (<30 days)",
    records: (await supabaseAdmin.from("events").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())).count ?? 0,
    oldest: recentEvents.data?.[0]?.created_at ?? "",
    newest: recentEvents.data?.[0]?.created_at ?? "",
  });

  stages.push({
    stage: "Old Events (>30 days, candidates for deletion)",
    records: (await supabaseAdmin.from("events").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).lt("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())).count ?? 0,
    oldest: oldEvents.data?.[0]?.created_at ?? "",
    newest: "",
  });

  return stages;
}
