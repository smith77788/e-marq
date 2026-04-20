/**
 * Legacy helper kept only to clear all tenant data.
 * Generation logic lives in src/lib/acosDataset.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

export async function clearDemoData(tenantId: string, supabase: SB): Promise<void> {
  // Order matters due to FKs: events → order_items → orders → products
  const { error: e1 } = await supabase.from("events").delete().eq("tenant_id", tenantId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("order_items").delete().eq("tenant_id", tenantId);
  if (e2) throw e2;
  const { error: e3 } = await supabase.from("orders").delete().eq("tenant_id", tenantId);
  if (e3) throw e3;
  const { error: e4 } = await supabase.from("products").delete().eq("tenant_id", tenantId);
  if (e4) throw e4;
}
