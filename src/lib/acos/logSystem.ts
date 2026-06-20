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
    .from("bootstrap_facts")
    .insert({
      fact_key: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fact_kind: "log",
      tenant_id: options?.tenantId ?? "system",
      confidence: 1.0,
      source: options?.source ?? "system",
      value: { level, message, context: options?.context ?? {}, source: options?.source ?? "system" } as never,
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
    .from("bootstrap_facts")
    .select("*")
    .eq("fact_kind", "log")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.tenantId) {
    query = query.eq("tenant_id", options.tenantId);
  }
  if (options?.source) {
    query = query.eq("source", options.source);
  }
  if (options?.since) {
    query = query.gte("created_at", options.since);
  }

  const { data } = await query;

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      level: (v.level as LogEntry["level"]) ?? "info",
      message: (v.message as string) ?? "",
      context: v.context as Record<string, unknown>,
      source: (v.source as string) ?? row.source ?? "system",
      created_at: row.created_at,
    } satisfies LogEntry;
  }).filter((e) => !options?.level || e.level === options.level);
}

/**
 * Очистити старі логи.
 */
export async function cleanupLogs(
  olderThanDays: number = 30,
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("bootstrap_facts")
    .delete()
    .eq("fact_kind", "log")
    .lt("created_at", cutoff);

  return { deleted: count ?? 0 };
}
