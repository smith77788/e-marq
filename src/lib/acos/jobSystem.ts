/**
 * Smart Job System — централізована система фонових задач.
 *
 * Типи задач:
 * 1. Report Generation — генерація звітів
 * 2. Data Sync — синхронізація даних
 * 3. Email Send — відправка листів
 * 4. Agent Run — запуск агентів
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Job = {
  id: string;
  tenant_id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed";
  payload: unknown;
  result?: unknown;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
};

/**
 * Створити задачу.
 */
export async function createJob(
  tenantId: string,
  type: string,
  payload: unknown,
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .insert({
      tenant_id: tenantId,
      type,
      status: "pending",
      payload,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Позначити як виконувану.
 */
export async function startJob(
  jobId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);

  return { ok: !error };
}

/**
 * Завершити задачу.
 */
export async function completeJob(
  jobId: string,
  result: unknown,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "completed",
      result,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return { ok: !error };
}

/**
 * Позначити як помилку.
 */
export async function failJob(
  jobId: string,
  error: string,
): Promise<{ ok: boolean }> {
  const { error: updateError } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return { ok: !updateError };
}

/**
 * Отримати задачі тенанта.
 */
export async function getJobs(
  tenantId: string,
  status?: string,
  limit: number = 50,
): Promise<Job[]> {
  let query = supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data } = await query;
  return (data ?? []) as Job[];
}
