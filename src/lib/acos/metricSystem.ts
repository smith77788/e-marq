/**
 * Smart Metric System — централізована система метрик.
 *
 * Типи метрик:
 * 1. Counter — лічильник (зростає)
 * 2. Gauge — індикатор (змінюється)
 * 3. Histogram — гістограма (розподіл)
 * 4. Timer — таймер (час виконання)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Metric = {
  id: string;
  tenant_id: string;
  name: string;
  value: number;
  type: "counter" | "gauge" | "histogram" | "timer";
  tags?: Record<string, string>;
  created_at: string;
};

/**
 * Записати метрику.
 */
export async function recordMetric(
  tenantId: string,
  name: string,
  value: number,
  type: Metric["type"] = "gauge",
  tags?: Record<string, string>,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("metrics")
    .insert({
      tenant_id: tenantId,
      name,
      value,
      type,
      tags,
    });

  return { ok: !error };
}

/**
 * Отримати метрики.
 */
export async function getMetrics(
  tenantId: string,
  name: string,
  options?: { since?: string; limit?: number },
): Promise<Metric[]> {
  let query = supabaseAdmin
    .from("metrics")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("name", name)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 1000);

  if (options?.since) {
    query = query.gte("created_at", options.since);
  }

  const { data } = await query;
  return (data ?? []) as Metric[];
}

/**
 * Агрегувати метрики.
 */
export function aggregateMetrics(
  metrics: Metric[],
  aggregation: "sum" | "avg" | "min" | "max" | "count",
): number {
  const values = metrics.map((m) => m.value);

  switch (aggregation) {
    case "sum":
      return values.reduce((s, v) => s + v, 0);
    case "avg":
      return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "count":
      return values.length;
    default:
      return 0;
  }
}
