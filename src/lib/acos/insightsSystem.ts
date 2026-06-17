/**
 * Smart Insights System — централізована система аналітичних висновків.
 *
 * Типи insights:
 * 1. Revenue Insight — виручка
 * 2. Customer Insight — клієнти
 * 3. Product Insight — товари
 * 4. Marketing Insight — маркетинг
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Insight = {
  id: string;
  type: "revenue" | "customer" | "product" | "marketing";
  title: string;
  description: string;
  impact: string;
  priority: "high" | "medium" | "low";
  action_url?: string;
  created_at: string;
};

/**
 * Згенерувати insights.
 */
export async function generateInsights(
  tenantId: string,
): Promise<Insight[]> {
  const insights: Insight[] = [];

  // Revenue insight
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
        id: `revenue-${Date.now()}`,
        type: "revenue",
        title: change > 0 ? "Виручка зросла" : "Виручка впала",
        description: `На ${Math.abs(Math.round(change))}% порівняно з минулим тижнем`,
        impact: `${Math.round(Math.abs(thisWeekTotal - prevWeekTotal) / 100)} ₴ різниці`,
        priority: Math.abs(change) > 30 ? "high" : "medium",
        action_url: "/brand/roi",
        created_at: new Date().toISOString(),
      });
    }
  }

  // Low stock insight
  const { data: lowStock } = await supabaseAdmin
    .from("products")
    .select("id, name, stock")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .lte("stock", 5)
    .gt("stock", 0);

  if (lowStock && lowStock.length > 0) {
    insights.push({
      id: `stock-${Date.now()}`,
      type: "product",
      title: "Товари закінчуються",
      description: `${lowStock.length} товарів мають менше 5 одиниць`,
      impact: "Можливі втрачені продажі",
      priority: "high",
      action_url: "/brand/products",
      created_at: new Date().toISOString(),
    });
  }

  return insights;
}
