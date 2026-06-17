/**
 * Smart Incident Management — керування інцидентами API.
 *
 * Функції:
 * 1. Створення інцидентів
 * 2. Ескалація
 * 3. Розв'язання
 * 4. Аналіз
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

/**
 * Створити інцидент.
 */
export async function createIncident(
  tenantId: string,
  title: string,
  description: string,
  severity: Incident["severity"],
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("incidents")
    .insert({
      tenant_id: tenantId,
      title,
      description,
      severity,
      status: "open",
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
  const updates: Record<string, unknown> = { status };
  if (status === "resolved") {
    updates.resolved_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("incidents")
    .update(updates)
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
    .from("incidents")
    .select("*")
    .eq("tenant_id", tenantId)
    .not("status", "eq", "resolved")
    .order("severity", { ascending: false });

  return (data ?? []) as Incident[];
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
    .from("incidents")
    .select("status, created_at, resolved_at")
    .eq("tenant_id", tenantId);

  const incidents = data ?? [];
  const open = incidents.filter((i) => i.status !== "resolved").length;
  const resolved = incidents.filter((i) => i.status === "resolved");

  const resolutionTimes = resolved
    .filter((i) => i.resolved_at)
    .map((i) => new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime());

  return {
    total: incidents.length,
    open,
    resolved: resolved.length,
    avgResolutionTime: resolutionTimes.length > 0
      ? resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length / 3600000 // hours
      : 0,
  };
}
