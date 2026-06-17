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
    .from("scheduled_jobs")
    .insert({
      tenant_id: tenantId,
      name,
      cron,
      handler,
      payload,
      enabled: true,
      run_count: 0,
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
    .from("scheduled_jobs")
    .insert({
      tenant_id: tenantId,
      name,
      delay_ms: delayMs,
      handler,
      payload,
      enabled: true,
      run_count: 0,
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
    .from("scheduled_jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  return (data ?? []) as ScheduledJob[];
}

/**
 * Увімкнути/вимкнути задачу.
 */
export async function toggleScheduledJob(
  jobId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("scheduled_jobs")
    .update({ enabled })
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
    .from("scheduled_jobs")
    .delete()
    .eq("id", jobId);

  return { ok: !error };
}
