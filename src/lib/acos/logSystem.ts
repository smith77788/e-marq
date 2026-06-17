/**
 * Smart Log System — централізована система логів.
 *
 * Рівні:
 * 1. DEBUG — відлагодження
 * 2. INFO — інформація
 * 3. WARN — попередження
 * 4. ERROR — помилки
 * 5. FATAL — критичні помилки
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LogEntry = {
  id: string;
  tenant_id?: string;
  level: "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  context?: Record<string, unknown>;
  source: string;
  created_at: string;
};

/**
 * Записати лог.
 */
export async function log(
  level: LogEntry["level"],
  message: string,
  options?: {
    tenantId?: string;
    context?: Record<string, unknown>;
    source?: string;
  },
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("logs")
    .insert({
      tenant_id: options?.tenantId,
      level,
      message,
      context: options?.context,
      source: options?.source ?? "system",
    });

  return { ok: !error };
}

/**
 * Отримати логи.
 */
export async function getLogs(
  options?: {
    tenantId?: string;
    level?: string;
    source?: string;
    limit?: number;
    since?: string;
  },
): Promise<LogEntry[]> {
  let query = supabaseAdmin
    .from("logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.tenantId) {
    query = query.eq("tenant_id", options.tenantId);
  }
  if (options?.level) {
    query = query.eq("level", options.level);
  }
  if (options?.source) {
    query = query.eq("source", options.source);
  }
  if (options?.since) {
    query = query.gte("created_at", options.since);
  }

  const { data } = await query;
  return (data ?? []) as LogEntry[];
}

/**
 * Очистити старі логи.
 */
export async function cleanupLogs(
  olderThanDays: number = 30,
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("logs")
    .delete()
    .lt("created_at", cutoff);

  return { deleted: count ?? 0 };
}
