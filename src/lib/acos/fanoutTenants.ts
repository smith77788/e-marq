import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Tenant statuses that cron / agent fan-outs must process.
 *
 * `pending` tenants are newly-onboarded and fully live — verification only
 * gates premium features, not core agent activity. Skipping them leaves a new
 * brand with zero insights / outbound until an admin flips them to `active`.
 * Project rule: fan-outs take ('active','pending').
 */
export const FANOUT_TENANT_STATUSES = ["active", "pending"] as const;

/** Tenant ids a cron fan-out should process (active + pending). */
export async function loadFanoutTenantIds(limit = 100): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .in("status", [...FANOUT_TENANT_STATUSES])
    .limit(limit);
  return (data ?? []).map((t) => t.id as string);
}
