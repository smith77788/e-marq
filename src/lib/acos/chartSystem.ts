/**
 * Smart Chart System — дані для різних типів графіків.
 *
 * Типи:
 * 1. Revenue over time
 * 2. Customer segments pie chart
 * 3. Product performance bar chart
 * 4. Conversion funnel
 * 5. Cohort retention heatmap
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ChartDataset = {
  label: string;
  data: number[];
  backgroundColor?: string;
  borderColor?: string;
};

export type ChartConfig = {
  type: string;
  title: string;
  labels: string[];
  datasets: ChartDataset[];
};

/**
 * Revenue over time chart data.
 */
export async function getRevenueChart(
  tenantId: string,
  days: number = 30,
): Promise<ChartConfig> {
  const labels: string[] = [];
  const values: number[] = [];

  for (let i = days - 1; i >= 0; i--) {
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

    labels.push(`${date.getDate()}.${date.getMonth() + 1}`);
    values.push(Math.round((data ?? []).reduce((s, o) => s + o.total_cents, 0) / 100));
  }

  return {
    type: "line",
    title: "Виручка",
    labels,
    datasets: [{
      label: "Виручка (₴)",
      data: values,
      borderColor: "#10b981",
    }],
  };
}

/**
 * Customer segments pie chart data.
 */
export async function getCustomerSegmentsChart(
  tenantId: string,
): Promise<ChartConfig> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("total_spent_cents, last_order_at")
    .eq("tenant_id", tenantId)
    .limit(5000);

  if (!customers) return { type: "pie", title: "Сегменти", labels: [], datasets: [] };

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
      backgroundColor: ["#FFD700", "#4CAF50", "#FF9800", "#F44336", "#2196F3"],
    }],
  };
}
