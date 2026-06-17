/**
 * Smart Workflow System — централізована система робочих процесів.
 *
 * Типи:
 * 1. Approval Workflow — затвердження
 * 2. Review Workflow — перегляд
 * 3. Escalation Workflow — ескалація
 * 4. Notification Workflow — сповіщення
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Workflow = {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  status: "active" | "paused" | "completed";
  steps: WorkflowStep[];
  current_step: number;
  created_at: string;
};

type WorkflowStep = {
  id: string;
  name: string;
  assignee?: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  due_date?: string;
};

/**
 * Створити workflow.
 */
export async function createWorkflow(
  tenantId: string,
  name: string,
  type: string,
  steps: Omit<WorkflowStep, "id" | "status">[],
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("workflows")
    .insert({
      tenant_id: tenantId,
      name,
      type,
      status: "active",
      steps: steps.map((s, i) => ({ ...s, id: `step-${i}`, status: "pending" })),
      current_step: 0,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Оновити статус кроку.
 */
export async function updateWorkflowStep(
  workflowId: string,
  stepId: string,
  status: WorkflowStep["status"],
): Promise<{ ok: boolean }> {
  const { data: workflow } = await supabaseAdmin
    .from("workflows")
    .select("steps")
    .eq("id", workflowId)
    .single();

  if (!workflow) return { ok: false };

  const steps = (workflow.steps as WorkflowStep[]).map((s) =>
    s.id === stepId ? { ...s, status } : s,
  );

  const currentStep = steps.findIndex((s) => s.status === "pending");

  const { error } = await supabaseAdmin
    .from("workflows")
    .update({
      steps,
      current_step: currentStep >= 0 ? currentStep : steps.length,
      status: currentStep >= 0 ? "active" : "completed",
    })
    .eq("id", workflowId);

  return { ok: !error };
}

/**
 * Отримати workflows тенанта.
 */
export async function getWorkflows(
  tenantId: string,
): Promise<Workflow[]> {
  const { data } = await supabaseAdmin
    .from("workflows")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Workflow[];
}
