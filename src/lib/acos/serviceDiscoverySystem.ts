/**
 * Smart Service Discovery — виявлення та реєстрація сервісів.
 *
 * Функції:
 * 1. Реєстрація сервісів
 * 2. Health check сервісів
 * 3. Load balancing між сервісами
 * 4. Service mesh
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Service = {
  id: string;
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  lastChecked: string;
  metadata: Record<string, unknown>;
};

/**
 * Зареєструвати сервіс.
 */
export async function registerService(
  name: string,
  url: string,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .upsert({
      fact_key: `service_${name}`,
      fact_kind: "service",
      tenant_id: "system",
      confidence: 1.0,
      source: "service_discovery",
      value: { name, url, status: "unknown", last_checked: new Date().toISOString(), metadata } as never,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Оновити статус сервісу.
 */
export async function updateServiceStatus(
  serviceId: string,
  status: Service["status"],
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", serviceId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({ value: { ...v, status, last_checked: new Date().toISOString() } as never })
    .eq("id", serviceId);

  return { ok: !error };
}

/**
 * Отримати здорові сервіси.
 */
export async function getHealthyServices(): Promise<Service[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("fact_kind", "service")
    .order("updated_at", { ascending: false });

  return (data ?? [])
    .map((row) => {
      const v = (row.value ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        name: (v.name as string) ?? "",
        url: (v.url as string) ?? "",
        status: (v.status as Service["status"]) ?? "unknown",
        lastChecked: (v.last_checked as string) ?? row.created_at,
        metadata: (v.metadata as Record<string, unknown>) ?? {},
      } satisfies Service;
    })
    .filter((s) => s.status === "healthy");
}

/**
 * Health check всіх сервісів.
 */
export async function checkAllServices(): Promise<Array<{
  service: string;
  status: string;
  latency: number;
}>> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("id, value")
    .eq("fact_kind", "service");

  if (!data) return [];

  const results = [];
  for (const row of data) {
    const v = (row.value ?? {}) as Record<string, unknown>;
    const name = (v.name as string) ?? "";
    const url = (v.url as string) ?? "";
    const start = Date.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      const status = response.ok ? "healthy" : "unhealthy";
      await updateServiceStatus(row.id, status as Service["status"]);
      results.push({ service: name, status, latency });
    } catch {
      await updateServiceStatus(row.id, "unhealthy");
      results.push({ service: name, status: "unhealthy", latency: Date.now() - start });
    }
  }

  return results;
}
