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
    .from("bootstrap_facts")
    .insert({
      fact_key: `metric_${tenantId}_${name}_${Date.now()}`,
      fact_kind: "metric",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "system",
      value: { name, metric_value: value, type, tags } as never,
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
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "metric")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 1000);

  if (options?.since) {
    query = query.gte("created_at", options.since);
  }

  const { data } = await query;

  return (data ?? [])
    .map((row) => {
      const v = (row.value ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        name: (v.name as string) ?? "",
        value: (v.metric_value as number) ?? 0,
        type: (v.type as Metric["type"]) ?? "gauge",
        tags: v.tags as Record<string, string>,
        created_at: row.created_at,
      } satisfies Metric;
    })
    .filter((m) => m.name === name);
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
