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

/**
 * Дані для графіка виручки за 30 днів.
 */
export async function getRevenueChartData(
  tenantId: string,
): Promise<ChartDataPoint[]> {
  const days30 = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 3600 * 1000);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString();

    const { data } = await supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd);

    const total = (data ?? []).reduce((s, o) => s + o.total_cents, 0);
    days30.push({
      label: `${date.getDate()}.${date.getMonth() + 1}`,
      value: Math.round(total / 100),
    });
  }

  return days30;
}

/**
 * Дані для графіка зростання клієнтів за 30 днів.
 */
export async function getCustomerGrowthChartData(
  tenantId: string,
): Promise<ChartDataPoint[]> {
  const days30 = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 3600 * 1000);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString();

    const { count } = await supabaseAdmin
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd);

    days30.push({
      label: `${date.getDate()}.${date.getMonth() + 1}`,
      value: count ?? 0,
    });
  }

  return days30;
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
