/**
 * Smart Team Collaboration — командна співпраця над бізнесом.
 *
 * Можливості:
 * 1. Коментарі до інсайтів
 * 2. Призначення відповідальних
 * 3. Статус завдань (todo/in_progress/done)
 * 4. Сповіщення про зміни
 * 5. Журнал активності
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TeamTask = {
  id: string;
  tenant_id: string;
  title: string;
  description?: string;
  assigned_to?: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  due_date?: string;
  created_by: string;
  created_at: string;
};

/**
 * Створити завдання.
 */
export async function createTask(
  tenantId: string,
  task: Omit<TeamTask, "id" | "tenant_id" | "created_at">,
): Promise<TeamTask | null> {
  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `task_${tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fact_kind: "team_task",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "team_collaboration",
      value: { ...task } as never,
    })
    .select()
    .single();

  if (error || !data) return null;

  const v = (data.value ?? {}) as Record<string, unknown>;
  return {
    id: data.id,
    tenant_id: tenantId,
    title: (v.title as string) ?? task.title,
    description: v.description as string | undefined,
    assigned_to: v.assigned_to as string | undefined,
    status: (v.status as TeamTask["status"]) ?? "todo",
    priority: (v.priority as TeamTask["priority"]) ?? "medium",
    due_date: v.due_date as string | undefined,
    created_by: (v.created_by as string) ?? task.created_by,
    created_at: data.created_at,
  };
}

/**
 * Оновити статус завдання.
 */
export async function updateTaskStatus(
  taskId: string,
  status: TeamTask["status"],
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", taskId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: { ...v, status } as never })
    .eq("id", taskId);

  return { ok: !error };
}

/**
 * Отримати завдання тенанта.
 */
export async function getTeamTasks(
  tenantId: string,
): Promise<TeamTask[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "team_task")
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      title: (v.title as string) ?? "",
      description: v.description as string | undefined,
      assigned_to: v.assigned_to as string | undefined,
      status: (v.status as TeamTask["status"]) ?? "todo",
      priority: (v.priority as TeamTask["priority"]) ?? "medium",
      due_date: v.due_date as string | undefined,
      created_by: (v.created_by as string) ?? "",
      created_at: row.created_at,
    } satisfies TeamTask;
  });
}

/**
 * Додати коментар до інсайту.
 */
export async function addInsightComment(
  tenantId: string,
  insightId: string,
  userId: string,
  comment: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `insight_comment_${insightId}_${Date.now()}`,
      fact_kind: "insight_comment",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "team_collaboration",
      value: { insight_id: insightId, user_id: userId, comment } as never,
    });

  return { ok: !error };
}
