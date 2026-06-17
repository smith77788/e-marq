/**
 * Smart Access Logging — логування доступу до ресурсів.
 *
 * Логує через таблицю `events` (tenant_id + type + payload).
 * Оригінальний тип доступу зберігається в payload.access_event,
 * а events.type використовує найближчий валідний тип із схеми.
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

// Mapping to valid event_type enum values only
const EVENT_TYPE_MAP: Record<
  AccessLog["event"],
  "session_start" | "message_sent" | "page_viewed" | "bot_interaction"
> = {
  login: "session_start",
  logout: "message_sent",
  page_view: "page_viewed",
  api_call: "bot_interaction",
  security_error: "bot_interaction",
};

const ACCESS_EVENT_TYPES = Array.from(new Set(Object.values(EVENT_TYPE_MAP)));

/**
 * Записати подію доступу в таблицю events.
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
  const { error } = await supabaseAdmin.from("events").insert({
    tenant_id: tenantId,
    user_id: options?.userId ?? null,
    type: EVENT_TYPE_MAP[event],
    payload: {
      access_event: event,
      resource,
      ip_address: options?.ipAddress ?? null,
      user_agent: options?.userAgent ?? null,
    } as never,
  });

  return { ok: !error };
}

/**
 * Отримати логи доступу з таблиці events.
 * Оригінальний тип події читається з payload.access_event.
 */
export async function getAccessLogs(
  tenantId: string,
  limit: number = 100,
): Promise<AccessLog[]> {
  const { data } = await supabaseAdmin
    .from("events")
    .select("id, tenant_id, user_id, type, payload, created_at")
    .eq("tenant_id", tenantId)
    .in("type", ACCESS_EVENT_TYPES)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).flatMap((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const accessEvent = p.access_event as AccessLog["event"] | undefined;
    if (!accessEvent) return [];
    return [
      {
        id: e.id,
        tenant_id: e.tenant_id,
        user_id: e.user_id ?? undefined,
        event: accessEvent,
        resource: (p.resource as string) ?? "",
        ip_address: (p.ip_address as string) ?? undefined,
        user_agent: (p.user_agent as string) ?? undefined,
        created_at: e.created_at,
      } satisfies AccessLog,
    ];
  });
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

  const { data: events } = await supabaseAdmin
    .from("events")
    .select("user_id, type, payload, created_at")
    .eq("tenant_id", tenantId)
    .in("type", ACCESS_EVENT_TYPES)
    .gte("created_at", weekAgo)
    .not("user_id", "is", null)
    .limit(10000);

  if (!events) return [];

  const userStats: Record<string, { logins: number; pages: number; api: number; lastActive: string }> = {};

  for (const e of events) {
    if (!e.user_id) continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const accessEvent = p.access_event as AccessLog["event"] | undefined;
    if (!accessEvent) continue;

    if (!userStats[e.user_id]) {
      userStats[e.user_id] = { logins: 0, pages: 0, api: 0, lastActive: e.created_at };
    }
    if (e.created_at > userStats[e.user_id].lastActive) {
      userStats[e.user_id].lastActive = e.created_at;
    }
    if (accessEvent === "login") userStats[e.user_id].logins++;
    if (accessEvent === "page_view") userStats[e.user_id].pages++;
    if (accessEvent === "api_call") userStats[e.user_id].api++;
  }

  return Object.entries(userStats).map(([userId, stats]) => ({
    user_id: userId,
    logins: stats.logins,
    pages_viewed: stats.pages,
    api_calls: stats.api,
    last_active: stats.lastActive,
  }));
}
