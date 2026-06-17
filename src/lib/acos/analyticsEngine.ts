/**
 * Smart Analytics Engine — централізована аналітика для прийняття рішень.
 *
 * Метрики:
 * 1. Revenue Metrics — виручка, AOV, конверсія
 * 2. Customer Metrics — LTV, churn, retention
 * 3. Product Metrics — популярність, маржинальність
 * 4. Marketing Metrics — ROI, CAC, ROAS
 *
 * Генерує actionable insights з рекомендаціями.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AnalyticsInsight = {
  metric: string;
  value: number;
  change: number; // percentage change
  trend: "up" | "down" | "stable";
  recommendation: string;
  priority: "high" | "medium" | "low";
};

/**
 * Отримати ключові метрики тенанта.
 */
export async function getKeyMetrics(
  tenantId: string,
): Promise<{
  revenue: { today: number; week: number; month: number; trend: number };
  customers: { total: number; new: number; active: number; churned: number };
  products: { total: number; active: number; top_seller: string };
  conversion: { rate: number; checkout_rate: number; cart_abandonment: number };
}> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

  const [todayOrders, weekOrders, monthOrders, customers, products] = await Promise.all([
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", today),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", monthAgo),
    supabaseAdmin.from("customers").select("id, created_at, last_order_at").eq("tenant_id", tenantId).limit(10000),
    supabaseAdmin.from("products").select("id, is_active").eq("tenant_id", tenantId),
  ]);

  const todayTotal = (todayOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const weekTotal = (weekOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const monthTotal = (monthOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);

  const allCustomers = customers.data ?? [];
  const newCustomers = allCustomers.filter((c) => new Date(c.created_at) > new Date(monthAgo)).length;
  const activeCustomers = allCustomers.filter((c) => c.last_order_at && new Date(c.last_order_at) > new Date(monthAgo)).length;
  const churnedCustomers = allCustomers.filter((c) => !c.last_order_at || new Date(c.last_order_at) < new Date(monthAgo)).length;

  const allProducts = products.data ?? [];
  const activeProducts = allProducts.filter((p) => p.is_active).length;

  // Revenue trend: compare this month vs previous month
  const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString();
  const [prevMonthOrders, topItemRes, conversionRes] = await Promise.all([
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", twoMonthsAgo).lt("created_at", monthAgo),
    supabaseAdmin.from("order_items").select("product_name, quantity").eq("tenant_id", tenantId).gte("created_at", monthAgo).limit(1000),
    supabaseAdmin.from("events").select("type, session_id").eq("tenant_id", tenantId).gte("created_at", monthAgo).in("type", ["checkout_started", "add_to_cart"]).limit(5000),
  ]);

  const prevMonthTotal = (prevMonthOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const trend = prevMonthTotal > 0 ? Math.round(((monthTotal - prevMonthTotal) / prevMonthTotal) * 100) : 0;

  // Top seller by quantity
  const qtySold: Record<string, number> = {};
  for (const item of topItemRes.data ?? []) {
    qtySold[item.product_name] = (qtySold[item.product_name] ?? 0) + (item.quantity ?? 1);
  }
  const topSeller = Object.entries(qtySold).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  // Conversion: checkouts → orders
  const events = conversionRes.data ?? [];
  const checkoutSessions = new Set(events.filter((e) => e.type === "checkout_started").map((e) => e.session_id)).size;
  const orderCount = (weekOrders.data ?? []).length;
  const conversionRate = checkoutSessions > 0 ? Math.round((orderCount / checkoutSessions) * 100) : 0;
  const cartSessions = new Set(events.filter((e) => e.type === "add_to_cart").map((e) => e.session_id)).size;
  const cartAbandonmentRate = cartSessions > 0 ? Math.round(((cartSessions - checkoutSessions) / cartSessions) * 100) : 0;

  return {
    revenue: {
      today: todayTotal,
      week: weekTotal,
      month: monthTotal,
      trend,
    },
    customers: {
      total: allCustomers.length,
      new: newCustomers,
      active: activeCustomers,
      churned: churnedCustomers,
    },
    products: {
      total: allProducts.length,
      active: activeProducts,
      top_seller: topSeller,
    },
    conversion: {
      rate: conversionRate,
      checkout_rate: checkoutSessions > 0 ? Math.round((checkoutSessions / cartSessions) * 100) : 0,
      cart_abandonment: cartAbandonmentRate,
    },
  };
}

/**
 * Генерувати actionable insights.
 */
export async function generateInsights(
  tenantId: string,
): Promise<AnalyticsInsight[]> {
  const metrics = await getKeyMetrics(tenantId);
  const insights: AnalyticsInsight[] = [];

  // Revenue insights
  if (metrics.revenue.trend < -10) {
    insights.push({
      metric: "Виручка",
      value: metrics.revenue.month,
      change: metrics.revenue.trend,
      trend: "down",
      recommendation: "Запустіть промоакцію або winback кампанію",
      priority: "high",
    });
  }

  // Customer insights
  if (metrics.customers.churned > metrics.customers.active) {
    insights.push({
      metric: "Відтік клієнтів",
      value: metrics.customers.churned,
      change: 0,
      trend: "down",
      recommendation: "Більше клієнтів пішли, ніж залишились. Перевірте retention стратегію",
      priority: "high",
    });
  }

  // Product insights
  if (metrics.products.active < 10) {
    insights.push({
      metric: "Асортимент",
      value: metrics.products.active,
      change: 0,
      trend: "stable",
      recommendation: "Мало активних товарів. Додайте нові позиції",
      priority: "medium",
    });
  }

  return insights;
}
