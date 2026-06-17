/**
 * Smart Data Visualization — дані для візуалізації.
 *
 * Типи візуалізацій:
 * 1. Bar Chart — стовпчикова діаграма
 * 2. Line Chart — лінійна діаграма
 * 3. Pie Chart — кругова діаграма
 * 4. Heat Map — карта тепла
 * 5. Funnel — воронка
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type VisualizationData = {
  type: "bar" | "line" | "pie" | "funnel";
  title: string;
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    color?: string;
  }>;
};

/**
 * Дані для воронки конверсії.
 */
export async function getFunnelVisualization(
  tenantId: string,
): Promise<VisualizationData> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [views, atcs, checkouts, purchases] = await Promise.all([
    supabaseAdmin.from("events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("type", "product_viewed").gte("created_at", weekAgo),
    supabaseAdmin.from("events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("type", "add_to_cart").gte("created_at", weekAgo),
    supabaseAdmin.from("events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("type", "checkout_started").gte("created_at", weekAgo),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo),
  ]);

  return {
    type: "funnel",
    title: "Воронка конверсії",
    labels: ["Перегляди", "Додано в кошик", "Checkout", "Покупки"],
    datasets: [{
      label: "Кількість",
      data: [
        views.count ?? 0,
        atcs.count ?? 0,
        checkouts.count ?? 0,
        purchases.count ?? 0,
      ],
      color: "#6366f1",
    }],
  };
}

/**
 * Дані для графіка виручки.
 */
export async function getRevenueVisualization(
  tenantId: string,
): Promise<VisualizationData> {
  const days = [];
  const values = [];

  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 3600 * 1000);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString();

    const { data } = await supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd);

    const total = (data ?? []).reduce((s, o) => s + o.total_cents, 0);
    days.push(`${date.getDate()}.${date.getMonth() + 1}`);
    values.push(Math.round(total / 100));
  }

  return {
    type: "line",
    title: "Виручка за 30 днів",
    labels: days,
    datasets: [{
      label: "Виручка (₴)",
      data: values,
      color: "#10b981",
    }],
  };
}

/**
 * Дані для графіка клієнтів за сегментами.
 */
export async function getCustomerSegmentVisualization(
  tenantId: string,
): Promise<VisualizationData> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("total_spent_cents, last_order_at")
    .eq("tenant_id", tenantId)
    .limit(5000);

  if (!customers) {
    return { type: "pie", title: "Сегменти клієнтів", labels: [], datasets: [] };
  }

  const now = Date.now();
  const segments: Record<string, number> = { VIP: 0, Loyal: 0, AtRisk: 0, Churned: 0, New: 0 };

  for (const c of customers) {
    const daysSince = c.last_order_at
      ? (now - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000)
      : Infinity;

    if (c.total_spent_cents > 100000) segments.VIP++;
    else if (daysSince > 60) segments.Churned++;
    else if (daysSince > 30) segments.AtRisk++;
    else if (c.total_spent_cents > 10000) segments.Loyal++;
    else segments.New++;
  }

  return {
    type: "pie",
    title: "Сегменти клієнтів",
    labels: Object.keys(segments),
    datasets: [{
      label: "Кількість",
      data: Object.values(segments),
      color: "#f59e0b",
    }],
  };
}
