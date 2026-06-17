/**
 * Smart Deployment System — керування деплоями.
 *
 * Функції:
 * 1. Створення деплоїв
 * 2. Відстеження статусу
 * 3. Відкат
 * 4. Моніторинг
 *
 * Storage: bootstrap_facts with fact_kind:"deployment"
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

type DeploymentValue = {
  version: string;
  status: Deployment["status"];
  environment: string;
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
  const value: DeploymentValue = { version, status: "pending", environment };

  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      tenant_id: tenantId,
      fact_kind: "deployment",
      fact_key: `deployment:${version}:${environment}`,
      value: value as never,
      source: "deployment_system",
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
  // Fetch existing value first
  const { data: existing } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", deploymentId)
    .maybeSingle();

  const current = (existing?.value as DeploymentValue | null) ?? {} as DeploymentValue;
  const updated: DeploymentValue = { ...current, status };
  if (status === "active") {
    updated.deployed_at = new Date().toISOString();
  } else if (status === "rolled_back") {
    updated.rolled_back_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: updated as never })
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
    .from("bootstrap_facts")
    .select("id, tenant_id, value, created_at")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "deployment")
    .order("created_at", { ascending: false })
    .limit(10);

  const active = (data ?? []).find((r) => (r.value as DeploymentValue)?.status === "active");
  if (!active) return null;

  const v = active.value as DeploymentValue;
  return {
    id: active.id,
    tenant_id: active.tenant_id,
    version: v.version,
    status: v.status,
    environment: v.environment,
    created_at: active.created_at,
    deployed_at: v.deployed_at,
    rolled_back_at: v.rolled_back_at,
  };
}

/**
 * Отримати історію деплоїв.
 */
export async function getDeploymentHistory(
  tenantId: string,
  limit: number = 10,
): Promise<Deployment[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("id, tenant_id, value, created_at")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "deployment")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => {
    const v = r.value as DeploymentValue;
    return {
      id: r.id,
      tenant_id: r.tenant_id,
      version: v.version,
      status: v.status,
      environment: v.environment,
      created_at: r.created_at,
      deployed_at: v.deployed_at,
      rolled_back_at: v.rolled_back_at,
    };
  });
}
