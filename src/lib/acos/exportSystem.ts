/**
 * Smart Export System — централізована система експорту даних.
 *
 * Формати:
 * 1. CSV — для Excel
 * 2. JSON — для API
 * 3. Excel — для бізнесу (майбутнє)
 *
 * Звіти:
 * 1. Revenue Report
 * 2. Customer Report
 * 3. Product Report
 * 4. Marketing Report
 */

/**
 * Експорт revenue звіту.
 */
export async function exportRevenue(
  data: Array<{ date: string; revenue: number; orders: number }>,
): Promise<string> {
  const lines = ["Date,Revenue (₴),Orders"];
  for (const row of data) {
    lines.push(`${row.date},${row.revenue},${row.orders}`);
  }
  return lines.join("\n");
}

/**
 * Експорт customer звіту.
 */
export async function exportCustomers(
  data: Array<{
    id: string;
    name: string;
    email: string;
    total_orders: number;
    total_spent: number;
    last_order: string;
  }>,
): Promise<string> {
  const lines = ["ID,Name,Email,Orders,Total Spent (₴),Last Order"];
  for (const row of data) {
    lines.push(`"${row.id}","${row.name}","${row.email}",${row.total_orders},${row.total_spent},${row.last_order}`);
  }
  return lines.join("\n");
}

/**
 * Експорт product звіту.
 */
export async function exportProducts(
  data: Array<{
    id: string;
    name: string;
    price: number;
    stock: number;
    monthly_sales: number;
  }>,
): Promise<string> {
  const lines = ["ID,Name,Price (₴),Stock,Monthly Sales"];
  for (const row of data) {
    lines.push(`"${row.id}","${row.name}",${row.price},${row.stock},${row.monthly_sales}`);
  }
  return lines.join("\n");
}
