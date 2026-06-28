/**
 * Smart Analytics Chart — дані для графіків аналітики.
 *
 * Типи графіків:
 * 1. Revenue Chart — виручка за період
 * 2. Customer Growth — зростання клієнтів
 * 3. Conversion Funnel — воронка конверсії
 * 4. Product Performance — продуктивність товарів
 * 5. Cohort Analysis — когортний аналіз
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ChartDataPoint = {
  label: string;
  value: number;
  secondary?: number;
};

function buildDayLabels(): Array<{ label: string; key: string }> {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 24 * 3600 * 1000);
    const key = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
    return { label: `${d.getDate()}.${d.getMonth() + 1}`, key };
  });
}

/**
 * Дані для графіка виручки за 30 днів.
 */
export async function getRevenueChartData(
  tenantId: string,
): Promise<ChartDataPoint[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("orders")
    .select("total_cents, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", since);

  const byDay = new Map<string, number>();
  for (const o of data ?? []) {
    const day = o.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + o.total_cents);
  }

  return buildDayLabels().map(({ label, key }) => ({
    label,
    value: Math.round((byDay.get(key) ?? 0) / 100),
  }));
}

/**
 * Дані для графіка зростання клієнтів за 30 днів.
 */
export async function getCustomerGrowthChartData(
  tenantId: string,
): Promise<ChartDataPoint[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("customers")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", since);

  const byDay = new Map<string, number>();
  for (const c of data ?? []) {
    const day = c.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return buildDayLabels().map(({ label, key }) => ({
    label,
    value: byDay.get(key) ?? 0,
  }));
}

/**
 * Дані для графіка топ-товарів.
 */
export async function getTopProductsChartData(
  tenantId: string,
  limit: number = 10,
): Promise<ChartDataPoint[]> {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: sales } = await supabaseAdmin
    .from("order_items")
    .select("product_name, quantity, unit_price_cents")
    .eq("tenant_id", tenantId)
    .gte("created_at", monthAgo)
    .limit(1000);

  if (!sales) return [];

  const freq: Record<string, { name: string; revenue: number }> = {};
  for (const s of sales) {
    if (!freq[s.product_name]) {
      freq[s.product_name] = { name: s.product_name, revenue: 0 };
    }
    freq[s.product_name].revenue += s.unit_price_cents * s.quantity;
  }

  return Object.values(freq)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map((p) => ({
      label: p.name,
      value: Math.round(p.revenue / 100),
    }));
}
