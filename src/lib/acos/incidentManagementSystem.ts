/**
 * Smart Incident Management — керування інцидентами API.
 *
 * Функції:
 * 1. Створення інцидентів
 * 2. Ескалація
 * 3. Розв'язання
 * 4. Аналіз
 *
 * Storage: bootstrap_facts with fact_kind:"incident"
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Incident = {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "identified" | "monitoring" | "resolved";
  assigned_to?: string;
  created_at: string;
  resolved_at?: string;
};

type IncidentValue = {
  title: string;
  description: string;
  severity: Incident["severity"];
  status: Incident["status"];
  assigned_to?: string;
  resolved_at?: string;
};

/**
 * Створити інцидент.
 */
export async function createIncident(
  tenantId: string,
  title: string,
  description: string,
  severity: Incident["severity"],
): Promise<{ ok: boolean; id?: string }> {
  const value: IncidentValue = { title, description, severity, status: "open" };

  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      tenant_id: tenantId,
      fact_kind: "incident",
      fact_key: `incident:${Date.now()}`,
      value: value as never,
      source: "incident_management",
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Оновити статус інциденту.
 */
export async function updateIncidentStatus(
  incidentId: string,
  status: Incident["status"],
): Promise<{ ok: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", incidentId)
    .maybeSingle();

  const current = (existing?.value as IncidentValue | null) ?? {} as IncidentValue;
  const updated: IncidentValue = { ...current, status };
  if (status === "resolved") {
    updated.resolved_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: updated as never })
    .eq("id", incidentId);

  return { ok: !error };
}

/**
 * Отримати відкриті інциденти.
 */
export async function getOpenIncidents(
  tenantId: string,
): Promise<Incident[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("id, tenant_id, value, created_at")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "incident")
    .order("created_at", { ascending: false });

  return (data ?? [])
    .filter((r) => (r.value as IncidentValue)?.status !== "resolved")
    .map((r) => {
      const v = r.value as IncidentValue;
      return {
        id: r.id,
        tenant_id: r.tenant_id,
        title: v.title,
        description: v.description,
        severity: v.severity,
        status: v.status,
        assigned_to: v.assigned_to,
        created_at: r.created_at,
        resolved_at: v.resolved_at,
      };
    });
}

/**
 * Аналіз інцидентів.
 */
export async function analyzeIncidents(
  tenantId: string,
): Promise<{
  total: number;
  open: number;
  resolved: number;
  avgResolutionTime: number;
}> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value, created_at")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "incident");

  const incidents = (data ?? []).map((r) => ({
    value: r.value as IncidentValue,
    created_at: r.created_at,
  }));

  const open = incidents.filter((i) => i.value?.status !== "resolved").length;
  const resolved = incidents.filter((i) => i.value?.status === "resolved");

  const resolutionTimes = resolved
    .filter((i) => i.value?.resolved_at)
    .map((i) => new Date(i.value.resolved_at!).getTime() - new Date(i.created_at).getTime());

  return {
    total: incidents.length,
    open,
    resolved: resolved.length,
    avgResolutionTime: resolutionTimes.length > 0
      ? resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length / 3600000 // hours
      : 0,
  };
}
