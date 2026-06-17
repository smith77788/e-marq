/**
 * Smart Access Logging — логування доступу до ресурсів.
 *
 * Логує:
 * 1. Вхід/вихід з системи
 * 2. Доступ до сторінок
 * 3. API виклики
 * 4. Помилки безпеки
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AccessLog = {
  id: string;
  tenant_id: string;
  user_id?: string;
  event: "login" | "logout" | "page_view" | "api_call" | "security_error";
  resource: string;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
};

/**
 * Записати подію доступу.
 */
export async function logAccess(
  tenantId: string,
  event: AccessLog["event"],
  resource: string,
  options?: {
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin.from("access_logs").insert({
    tenant_id: tenantId,
    user_id: options?.userId,
    event,
    resource,
    ip_address: options?.ipAddress,
    user_agent: options?.userAgent,
  });

  return { ok: !error };
}

/**
 * Отримати логи доступу.
 */
export async function getAccessLogs(
  tenantId: string,
  limit: number = 100,
): Promise<AccessLog[]> {
  const { data } = await supabaseAdmin
    .from("access_logs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as AccessLog[];
}

/**
 * Аналіз активності користувачів.
 */
export async function analyzeUserActivity(
  tenantId: string,
): Promise<Array<{
  user_id: string;
  logins: number;
  pages_viewed: number;
  api_calls: number;
  last_active: string;
}>> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: logs } = await supabaseAdmin
    .from("access_logs")
    .select("user_id, event, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", weekAgo)
    .limit(10000);

  if (!logs) return [];

  // Агрегувати по користувачах
  const userStats: Record<string, { logins: number; pages: number; api: number; lastActive: string }> = {};

  for (const log of logs) {
    if (!log.user_id) continue;
    if (!userStats[log.user_id]) {
      userStats[log.user_id] = { logins: 0, pages: 0, api: 0, lastActive: log.created_at };
    }
    if (log.event === "login") userStats[log.user_id].logins++;
    if (log.event === "page_view") userStats[log.user_id].pages++;
    if (log.event === "api_call") userStats[log.user_id].api++;
  }

  return Object.entries(userStats).map(([userId, stats]) => ({
    user_id: userId,
    logins: stats.logins,
    pages_viewed: stats.pages,
    api_calls: stats.api,
    last_active: stats.lastActive,
  }));
}
