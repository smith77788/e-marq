/**
 * Smart Report System — централізована система звітів.
 *
 * Типи звітів:
 * 1. Revenue Report — звіт по виручці
 * 2. Customer Report — звіт по клієнтах
 * 3. Product Report — звіт по товарах
 * 4. Marketing Report — звіт по маркетингу
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Report = {
  id: string;
  type: string;
  title: string;
  period: string;
  data: Record<string, unknown>;
  generated_at: string;
};

/**
 * Згенерувати звіт по виручці.
 */
export async function generateRevenueReport(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<Report> {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("total_cents, status, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const totalRevenue = (orders ?? []).reduce((s, o) => s + o.total_cents, 0);
  const totalOrders = (orders ?? []).length;
  const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return {
    id: `revenue-${Date.now()}`,
    type: "revenue",
    title: "Звіт по виручці",
    period: `${startDate} — ${endDate}`,
    data: {
      totalRevenue,
      totalOrders,
      avgOrder,
      formattedRevenue: `${Math.round(totalRevenue / 100).toLocaleString("uk-UA")} ₴`,
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * Згенерувати звіт по клієнтах.
 */
export async function generateCustomerReport(
  tenantId: string,
): Promise<Report> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, total_orders, total_spent_cents, last_order_at")
    .eq("tenant_id", tenantId)
    .limit(10000);

  const totalCustomers = (customers ?? []).length;
  const totalRevenue = (customers ?? []).reduce((s, c) => s + c.total_spent_cents, 0);
  const avgLtv = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

  return {
    id: `customers-${Date.now()}`,
    type: "customers",
    title: "Звіт по клієнтах",
    period: "Весь час",
    data: {
      totalCustomers,
      totalRevenue,
      avgLtv,
    },
    generated_at: new Date().toISOString(),
  };
}
