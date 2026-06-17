/**
 * Smart Audit Trail — журнал всіх дій в системі.
 *
 * Що логується:
 * 1. Зміни даних
 * 2. Авторизації
 * 3. Фінансові операції
 * 4. Зміни налаштувань
 * 5. Дії агентів
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuditEntry = {
  id: string;
  tenant_id: string;
  user_id?: string;
  action: string;
  resource: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
};

/**
 * Записати дію в журнал аудиту.
 */
export async function logAuditEntry(
  tenantId: string,
  action: string,
  resource: string,
  options?: {
    userId?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: options?.userId,
    action,
    resource,
    resource_id: options?.resourceId,
    details: options?.details,
    ip_address: options?.ipAddress,
  });

  return { ok: !error };
}

/**
 * Отримати журнал аудиту.
 */
export async function getAuditLog(
  tenantId: string,
  limit: number = 100,
): Promise<AuditEntry[]> {
  const { data } = await supabaseAdmin
    .from("audit_log")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as AuditEntry[];
}
