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
    .from("team_tasks")
    .insert({ ...task, tenant_id: tenantId })
    .select()
    .single();

  if (error || !data) return null;
  return data as TeamTask;
}

/**
 * Оновити статус завдання.
 */
export async function updateTaskStatus(
  taskId: string,
  status: TeamTask["status"],
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("team_tasks")
    .update({ status })
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
    .from("team_tasks")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  return (data ?? []) as TeamTask[];
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
  const { error } = await supabaseAdmin.from("insight_comments").insert({
    tenant_id: tenantId,
    insight_id: insightId,
    user_id: userId,
    comment,
  });

  return { ok: !error };
}
