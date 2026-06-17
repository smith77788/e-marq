/**
 * Smart Scheduler System — централізована система планування задач.
 *
 * Розклад:
 * 1. Cron Jobs — регулярні задачі
 * 2. One-time Jobs — одноразові задачі
 * 3. Delayed Jobs — відкладені задачі
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ScheduledJob = {
  id: string;
  tenant_id: string;
  name: string;
  cron?: string;
  delay_ms?: number;
  handler: string;
  payload: unknown;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
  run_count: number;
};

/**
 * Запланувати cron задачу.
 */
export async function scheduleCronJob(
  tenantId: string,
  name: string,
  cron: string,
  handler: string,
  payload: unknown,
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `scheduler_${tenantId}_${name}`,
      fact_kind: "scheduler_job",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "scheduler",
      value: { name, cron, handler, payload, enabled: true, run_count: 0 } as never,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Запланувати відкладену задачу.
 */
export async function scheduleDelayedJob(
  tenantId: string,
  name: string,
  delayMs: number,
  handler: string,
  payload: unknown,
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `scheduler_${tenantId}_${name}_${Date.now()}`,
      fact_kind: "scheduler_job",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "scheduler",
      value: { name, delay_ms: delayMs, handler, payload, enabled: true, run_count: 0 } as never,
      expires_at: new Date(Date.now() + delayMs + 86400_000).toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати заплановані задачі.
 */
export async function getScheduledJobs(
  tenantId: string,
): Promise<ScheduledJob[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "scheduler_job")
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: (v.name as string) ?? "",
      cron: v.cron as string | undefined,
      delay_ms: v.delay_ms as number | undefined,
      handler: (v.handler as string) ?? "",
      payload: v.payload,
      enabled: (v.enabled as boolean) ?? true,
      last_run: v.last_run as string | undefined,
      next_run: v.next_run as string | undefined,
      run_count: (v.run_count as number) ?? 0,
    } satisfies ScheduledJob;
  });
}

/**
 * Увімкнути/вимкнути задачу.
 */
export async function toggleScheduledJob(
  jobId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", jobId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: { ...v, enabled } as never })
    .eq("id", jobId);

  return { ok: !error };
}

/**
 * Видалити заплановану задачу.
 */
export async function deleteScheduledJob(
  jobId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .delete()
    .eq("id", jobId);

  return { ok: !error };
}
