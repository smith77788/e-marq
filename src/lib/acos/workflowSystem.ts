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
    .from("bootstrap_facts")
    .insert({
      fact_key: `workflow_${tenantId}_${name}_${Date.now()}`,
      fact_kind: "workflow",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "workflow_system",
      value: {
        name,
        type,
        status: "active",
        steps: steps.map((s, i) => ({ ...s, id: `step-${i}`, status: "pending" })),
        current_step: 0,
      } as never,
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
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", workflowId)
    .single();

  if (!row) return { ok: false };

  const v = (row.value ?? {}) as Record<string, unknown>;
  const steps = ((v.steps as WorkflowStep[]) ?? []).map((s) =>
    s.id === stepId ? { ...s, status } : s,
  );

  const currentStep = steps.findIndex((s) => s.status === "pending");

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({
      value: {
        ...v,
        steps,
        current_step: currentStep >= 0 ? currentStep : steps.length,
        status: currentStep >= 0 ? "active" : "completed",
      } as never,
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
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "workflow")
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: (v.name as string) ?? "",
      type: (v.type as string) ?? "",
      status: (v.status as Workflow["status"]) ?? "active",
      steps: (v.steps as WorkflowStep[]) ?? [],
      current_step: (v.current_step as number) ?? 0,
      created_at: row.created_at,
    } satisfies Workflow;
  });
}
