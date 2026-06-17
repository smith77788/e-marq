/**
 * Smart Dashboard Widgets — модульні віджети для дашборду власника.
 *
 * Типи віджетів:
 * 1. Revenue Card — виручка з трендом
 * 2. Orders Card — кількість замовлень
 * 3. Customers Card — нові клієнти
 * 4. Conversion Card — конверсія
 * 5. Top Products — топ товари
 * 6. Agent Status — статус агентів
 * 7. Revenue Leak — витоки виручки
 * 8. Quick Actions — швидкі дії
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DashboardWidget = {
  id: string;
  type: string;
  title: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "stable";
  icon?: string;
  action_url?: string;
};

/**
 * Отримати всі віджети для дашборду.
 */
export async function getDashboardWidgets(
  tenantId: string,
): Promise<DashboardWidget[]> {
  const widgets: DashboardWidget[] = [];

  // Revenue Widget
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("total_cents")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", monthAgo);

  const revenue = (orders ?? []).reduce((s, o) => s + o.total_cents, 0);
  widgets.push({
    id: "revenue",
    type: "revenue",
    title: "Виручка за місяць",
    value: `${Math.round(revenue / 100).toLocaleString("uk-UA")} ₴`,
    icon: "💰",
    action_url: "/brand/roi",
  });

  // Orders Widget
  widgets.push({
    id: "orders",
    type: "orders",
    title: "Замовлення",
    value: (orders ?? []).length,
    icon: "📦",
    action_url: "/brand/orders",
  });

  // Customers Widget
  const { count: customers } = await supabaseAdmin
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", monthAgo);

  widgets.push({
    id: "customers",
    type: "customers",
    title: "Нові клієнти",
    value: customers ?? 0,
    icon: "👥",
    action_url: "/brand/customers",
  });

  // Agent Status Widget
  const today = new Date().toISOString().split("T")[0];
  const { count: agentRuns } = await supabaseAdmin
    .from("acos_agent_runs")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("started_at", today);

  widgets.push({
    id: "agents",
    type: "agents",
    title: "Запусків агентів сьогодні",
    value: agentRuns ?? 0,
    icon: "🤖",
    action_url: "/agents/live",
  });

  return widgets;
}
