/**
 * Smart Analytics System — централізована система аналітики.
 *
 * Модулі:
 * 1. Revenue Analytics — аналітика виручки
 * 2. Customer Analytics — аналітика клієнтів
 * 3. Product Analytics — аналітика товарів
 * 4. Marketing Analytics — аналітика маркетингу
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AnalyticsSummary = {
  revenue: {
    today: number;
    week: number;
    month: number;
    trend: number;
  };
  customers: {
    total: number;
    new: number;
    active: number;
    churned: number;
  };
  products: {
    total: number;
    active: number;
    topSeller: string;
  };
  conversion: {
    rate: number;
    checkoutRate: number;
    cartAbandonment: number;
  };
};

/**
 * Отримати повний аналітичний звіт.
 */
export async function getAnalyticsSummary(
  tenantId: string,
): Promise<AnalyticsSummary> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
  const prevWeekAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString();

  const [todayOrders, weekOrders, monthOrders, prevWeekOrders, customers, products] =
    await Promise.all([
      supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", todayStart),
      supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo),
      supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", monthAgo),
      supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", prevWeekAgo).lt("created_at", weekAgo),
      supabaseAdmin.from("customers").select("id, created_at, last_order_at").eq("tenant_id", tenantId).limit(10000),
      supabaseAdmin.from("products").select("id, is_active").eq("tenant_id", tenantId),
    ]);

  const todayTotal = (todayOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const weekTotal = (weekOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const monthTotal = (monthOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const prevWeekTotal = (prevWeekOrders.data ?? []).reduce((s, o) => s + o.total_cents, 0);

  const allCustomers = customers.data ?? [];
  const newCustomers = allCustomers.filter((c) => new Date(c.created_at) > new Date(monthAgo)).length;
  const activeCustomers = allCustomers.filter((c) => c.last_order_at && new Date(c.last_order_at) > new Date(monthAgo)).length;
  const churnedCustomers = allCustomers.filter((c) => !c.last_order_at || new Date(c.last_order_at) < new Date(monthAgo)).length;

  const allProducts = products.data ?? [];
  const activeProducts = allProducts.filter((p) => p.is_active).length;

  return {
    revenue: {
      today: todayTotal,
      week: weekTotal,
      month: monthTotal,
      trend: prevWeekTotal > 0 ? ((weekTotal - prevWeekTotal) / prevWeekTotal) * 100 : 0,
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
      topSeller: "",
    },
    conversion: {
      rate: 0,
      checkoutRate: 0,
      cartAbandonment: 0,
    },
  };
}
