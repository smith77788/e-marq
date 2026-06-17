/**
 * Smart Analytics Export — експорт аналітичних даних.
 *
 * Формати:
 * 1. CSV — для Excel
 * 2. JSON — для API
 * 3. PDF — для звітів (майбутнє)
 *
 * Експорт:
 * 1. Revenue report
 * 2. Customer report
 * 3. Product report
 * 4. Marketing report
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Експорт звіту по виручці.
 */
export async function exportRevenueReport(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, status, total_cents, currency, customer_email, created_at, paid_at")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .order("created_at")
    .limit(10000);

  if (!orders || orders.length === 0) return "Order ID,Total,Currency,Email,Date\n";

  // CSV header
  const lines = ["Order ID,Total (₴),Currency,Email,Date"];
  for (const o of orders) {
    lines.push(
      `${o.id},${o.total_cents / 100},${o.currency},"${o.customer_email ?? ""}",${o.created_at}`,
    );
  }

  return lines.join("\n");
}

/**
 * Експорт звіту по клієнтах.
 */
export async function exportCustomerReport(
  tenantId: string,
): Promise<string> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, total_orders, total_spent_cents, avg_order_cents, last_order_at, created_at")
    .eq("tenant_id", tenantId)
    .order("total_spent_cents", { ascending: false })
    .limit(10000);

  if (!customers || customers.length === 0) return "Customer ID,Name,Email,Orders,Total Spent,Avg Order,Last Order\n";

  const lines = ["Customer ID,Name,Email,Orders,Total Spent (₴),Avg Order (₴),Last Order"];
  for (const c of customers) {
    lines.push(
      `${c.id},"${c.name ?? ""}","${c.email ?? ""}",${c.total_orders},${c.total_spent_cents / 100},${(c.avg_order_cents ?? 0) / 100},${c.last_order_at ?? ""}`,
    );
  }

  return lines.join("\n");
}

/**
 * Експорт звіту по товарах.
 */
export async function exportProductReport(
  tenantId: string,
): Promise<string> {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [products, sales] = await Promise.all([
    supabaseAdmin.from("products").select("id, name, price_cents, stock, is_active").eq("tenant_id", tenantId).limit(1000),
    supabaseAdmin.from("order_items").select("product_id, quantity, unit_price_cents").eq("tenant_id", tenantId).gte("created_at", monthAgo).limit(5000),
  ]);

  const salesMap: Record<string, { qty: number; revenue: number }> = {};
  for (const s of sales.data ?? []) {
    if (!s.product_id) continue;
    if (!salesMap[s.product_id]) salesMap[s.product_id] = { qty: 0, revenue: 0 };
    salesMap[s.product_id].qty += s.quantity;
    salesMap[s.product_id].revenue += s.unit_price_cents * s.quantity;
  }

  const lines = ["Product ID,Name,Price (₴),Stock,Active,Monthly Sales,Monthly Revenue (₴)"];
  for (const p of products.data ?? []) {
    const s = salesMap[p.id] ?? { qty: 0, revenue: 0 };
    lines.push(
      `${p.id},"${p.name}",${p.price_cents / 100},${p.stock},${p.is_active},${s.qty},${s.revenue / 100}`,
    );
  }

  return lines.join("\n");
}
