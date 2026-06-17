/**
 * Smart Analytics Comparison — порівняння метрик за різні періоди.
 *
 * Порівняння:
 * 1. Тиждень vs Тиждень (WoW)
 * 2. Місяць vs Місяць (MoM)
 * 3. Рік vs Рік (YoY)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ComparisonResult = {
  metric: string;
  current: number;
  previous: number;
  change: number;
  change_pct: number;
  trend: "up" | "down" | "stable";
};

/**
 * Порівняти два періоди.
 */
export async function comparePeriods(
  tenantId: string,
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  previousEnd: string,
): Promise<ComparisonResult[]> {
  const [currentOrders, previousOrders] = await Promise.all([
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", currentStart).lte("created_at", currentEnd),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", previousStart).lte("created_at", previousEnd),
  ]);

  const currentRevenue = (currentOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const previousRevenue = (previousOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const currentCount = (currentOrders.data ?? []).length;
  const previousCount = (previousOrders.data ?? []).length;

  return [
    compareMetric("Виручка", currentRevenue, previousRevenue),
    compareMetric("Замовлення", currentCount, previousCount),
  ];
}

function compareMetric(name: string, current: number, previous: number): ComparisonResult {
  const change = current - previous;
  const changePct = previous > 0 ? (change / previous) * 100 : 0;

  return {
    metric: name,
    current,
    previous,
    change,
    change_pct: Math.round(changePct * 10) / 10,
    trend: changePct > 5 ? "up" : changePct < -5 ? "down" : "stable",
  };
}
