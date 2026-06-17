/**
 * Smart Analytics Insights — автоматичні аналітичні висновки.
 *
 * Типи insights:
 * 1. Trend — тренд (зростання/падіння)
 * 2. Anomaly — аномалія
 * 3. Opportunity — можливість
 * 4. Warning — попередження
 * 5. Recommendation — рекомендація
 *
 * Генеруються автоматично на основі даних.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AnalyticsInsight = {
  id: string;
  type: "trend" | "anomaly" | "opportunity" | "warning" | "recommendation";
  title: string;
  description: string;
  impact: string;
  priority: "high" | "medium" | "low";
  created_at: string;
};

/**
 * Генерувати insights на основі даних.
 */
export async function generateAnalyticsInsights(
  tenantId: string,
): Promise<AnalyticsInsight[]> {
  const insights: AnalyticsInsight[] = [];

  // 1. Revenue trend
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const prevWeekAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

  const [thisWeek, prevWeek] = await Promise.all([
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", prevWeekAgo).lt("created_at", weekAgo),
  ]);

  const thisWeekTotal = (thisWeek.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const prevWeekTotal = (prevWeek.data ?? []).reduce((s, o) => s + o.total_cents, 0);

  if (prevWeekTotal > 0) {
    const change = ((thisWeekTotal - prevWeekTotal) / prevWeekTotal) * 100;
    if (Math.abs(change) > 10) {
      insights.push({
        id: `revenue-trend-${Date.now()}`,
        type: change > 0 ? "trend" : "warning",
        title: change > 0 ? "Виручка зросла" : "Виручка впала",
        description: `На ${Math.abs(Math.round(change))}% порівняно з минулим тижнем`,
        impact: `${Math.round(Math.abs(thisWeekTotal - prevWeekTotal) / 100)} ₴ різниці`,
        priority: Math.abs(change) > 30 ? "high" : "medium",
        created_at: new Date().toISOString(),
      });
    }
  }

  // 2. Low stock warning
  const { data: lowStock } = await supabaseAdmin
    .from("products")
    .select("id, name, stock")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .lte("stock", 5)
    .gt("stock", 0);

  if (lowStock && lowStock.length > 0) {
    insights.push({
      id: `low-stock-${Date.now()}`,
      type: "warning",
      title: "Товари закінчуються",
      description: `${lowStock.length} товарів мають менше 5 одиниць`,
      impact: "Можливі втрачені продажі",
      priority: "high",
      created_at: new Date().toISOString(),
    });
  }

  // 3. Conversion opportunity
  const { count: checkoutCount } = await supabaseAdmin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("type", "checkout_started")
    .gte("created_at", weekAgo);

  const { count: purchaseCount } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", weekAgo);
  const conversionRate = (checkoutCount ?? 0) > 0 ? ((purchaseCount ?? 0) / (checkoutCount ?? 1)) * 100 : 0;

  if (conversionRate < 50 && (checkoutCount ?? 0) > 10) {
    insights.push({
      id: `conversion-${Date.now()}`,
      type: "opportunity",
      title: "Потенціал покращення конверсії",
      description: `Конверсія checkout: ${Math.round(conversionRate)}% (бенчмарк: 65%)`,
      impact: `+${Math.round((65 - conversionRate) * (checkoutCount ?? 0) / 100)} замовлень/тиждень`,
      priority: "high",
      created_at: new Date().toISOString(),
    });
  }

  return insights;
}
