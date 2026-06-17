/**
 * Smart Deployment System — керування деплоями.
 *
 * Функції:
 * 1. Створення деплоїв
 * 2. Відстеження статусу
 * 3. Відкат
 * 4. Моніторинг
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Deployment = {
  id: string;
  tenant_id: string;
  version: string;
  status: "pending" | "deploying" | "active" | "failed" | "rolled_back";
  environment: string;
  created_at: string;
  deployed_at?: string;
  rolled_back_at?: string;
};

/**
 * Створити деплой.
 */
export async function createDeployment(
  tenantId: string,
  version: string,
  environment: string = "production",
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("deployments")
    .insert({
      tenant_id: tenantId,
      version,
      status: "pending",
      environment,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Оновити статус деплою.
 */
export async function updateDeploymentStatus(
  deploymentId: string,
  status: Deployment["status"],
): Promise<{ ok: boolean }> {
  const updates: Record<string, unknown> = { status };
  if (status === "active") {
    updates.deployed_at = new Date().toISOString();
  } else if (status === "rolled_back") {
    updates.rolled_back_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("deployments")
    .update(updates)
    .eq("id", deploymentId);

  return { ok: !error };
}

/**
 * Отримати останній активний деплой.
 */
export async function getActiveDeployment(
  tenantId: string,
): Promise<Deployment | null> {
  const { data } = await supabaseAdmin
    .from("deployments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("deployed_at", { ascending: false })
    .limit(1)
    .single();

  return data as Deployment | null;
}

/**
 * Отримати історію деплоїв.
 */
export async function getDeploymentHistory(
  tenantId: string,
  limit: number = 10,
): Promise<Deployment[]> {
  const { data } = await supabaseAdmin
    .from("deployments")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as Deployment[];
}
