/**
 * Smart Dashboard System — централізована система дашборду.
 *
 * Секції:
 * 1. Revenue Overview — огляд виручки
 * 2. Customer Analytics — аналітика клієнтів
 * 3. Product Performance — продуктивність товарів
 * 4. Agent Status — стан агентів
 * 5. Quick Actions — швидкі дії
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getKeyMetrics } from "./analyticsEngine";
import { generateAnalyticsInsights } from "./analyticsInsights";
import { getDashboardWidgets } from "./dashboardWidgets";

export type DashboardSection = {
  id: string;
  title: string;
  widgets: Array<{
    id: string;
    type: string;
    title: string;
    value: string | number;
    trend?: { direction: string; percentage: number };
  }>;
};

/**
 * Отримати повний дашборд.
 */
export async function getFullDashboard(
  tenantId: string,
): Promise<{
  sections: DashboardSection[];
  insights: Array<{ title: string; description: string; priority: string }>;
  last_updated: string;
}> {
  const [metrics, widgets, insights] = await Promise.all([
    getKeyMetrics(tenantId),
    getDashboardWidgets(tenantId),
    generateAnalyticsInsights(tenantId),
  ]);

  const sections: DashboardSection[] = [
    {
      id: "revenue",
      title: "Виручка",
      widgets: [
        { id: "today", type: "kpi", title: "Сьогодні", value: `${Math.round(metrics.revenue.today / 100)} ₴` },
        { id: "week", type: "kpi", title: "Тиждень", value: `${Math.round(metrics.revenue.week / 100)} ₴` },
        { id: "month", type: "kpi", title: "Місяць", value: `${Math.round(metrics.revenue.month / 100)} ₴` },
        { id: "trend", type: "trend", title: "Тренд", value: metrics.revenue.trend, trend: { direction: metrics.revenue.trend > 0 ? "up" : "down", percentage: metrics.revenue.trend } },
      ],
    },
    {
      id: "customers",
      title: "Клієнти",
      widgets: [
        { id: "total", type: "kpi", title: "Всього", value: metrics.customers.total },
        { id: "new", type: "kpi", title: "Нові", value: metrics.customers.new },
        { id: "active", type: "kpi", title: "Активні", value: metrics.customers.active },
        { id: "churned", type: "kpi", title: "Відтік", value: metrics.customers.churned },
      ],
    },
    {
      id: "products",
      title: "Товари",
      widgets: [
        { id: "total_products", type: "kpi", title: "Всього", value: metrics.products.total },
        { id: "active_products", type: "kpi", title: "Активні", value: metrics.products.active },
      ],
    },
  ];

  return {
    sections,
    insights: insights.map((i) => ({ title: i.title, description: i.description, priority: i.priority })),
    last_updated: new Date().toISOString(),
  };
}
