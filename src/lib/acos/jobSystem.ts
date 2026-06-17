/**
 * Smart Job System — централізована система фонових задач.
 *
 * Типи задач:
 * 1. Report Generation — генерація звітів
 * 2. Data Sync — синхронізація даних
 * 3. Email Send — відправка листів
 * 4. Agent Run — запуск агентів
 *
 * Storage: acos_agent_runs table
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
    .from("acos_agent_runs")
    .insert({
      tenant_id: tenantId,
      agent_id: type,
      status: "pending",
      metadata: { type, payload } as never,
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
    .from("acos_agent_runs")
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
    .from("acos_agent_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      metadata: { result } as never,
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
    .from("acos_agent_runs")
    .update({
      status: "failed",
      error,
      finished_at: new Date().toISOString(),
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
    .from("acos_agent_runs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data } = await query;
  return (data ?? []).map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    type: r.agent_id,
    status: r.status as Job["status"],
    payload: (r.metadata as Record<string, unknown>)?.payload,
    result: (r.metadata as Record<string, unknown>)?.result,
    error: r.error ?? undefined,
    started_at: r.started_at ?? undefined,
    completed_at: r.finished_at ?? undefined,
    created_at: r.started_at,
  }));
}
