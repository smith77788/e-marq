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
    .from("services")
    .upsert({
      name,
      url,
      status: "unknown",
      last_checked: new Date().toISOString(),
      metadata,
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
  const { error } = await supabaseAdmin
    .from("services")
    .update({
      status,
      last_checked: new Date().toISOString(),
    })
    .eq("id", serviceId);

  return { ok: !error };
}

/**
 * Отримати здорові сервіси.
 */
export async function getHealthyServices(): Promise<Service[]> {
  const { data } = await supabaseAdmin
    .from("services")
    .select("*")
    .eq("status", "healthy")
    .order("last_checked", { ascending: false });

  return (data ?? []) as Service[];
}

/**
 * Health check всіх сервісів.
 */
export async function checkAllServices(): Promise<Array<{
  service: string;
  status: string;
  latency: number;
}>> {
  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, name, url");

  if (!services) return [];

  const results = [];
  for (const service of services) {
    const start = Date.now();
    try {
      const response = await fetch(service.url, {
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;
      const status = response.ok ? "healthy" : "unhealthy";

      await updateServiceStatus(service.id, status as Service["status"]);
      results.push({ service: service.name, status, latency });
    } catch {
      await updateServiceStatus(service.id, "unhealthy");
      results.push({ service: service.name, status: "unhealthy", latency: Date.now() - start });
    }
  }

  return results;
}
