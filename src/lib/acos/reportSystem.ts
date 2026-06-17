/**
 * Smart Report System — централізована система звітів.
 *
 * Типи звітів:
 * 1. Daily Report — щоденний
 * 2. Weekly Report — тижневий
 * 3. Monthly Report — місячний
 * 4. Custom Report — кастомний
 *
 * Формати:
 * 1. HTML — для email
 * 2. PDF — для завантаження (майбутнє)
 * 3. CSV — для Excel
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getKeyMetrics, generateInsights } from "./analyticsEngine";

export type Report = {
  id: string;
  type: string;
  title: string;
  period: string;
  generated_at: string;
  content: string;
  metrics: Record<string, number>;
};

/**
 * Згенерувати звіт.
 */
export async function generateReport(
  tenantId: string,
  type: "daily" | "weekly" | "monthly",
): Promise<Report> {
  const metrics = await getKeyMetrics(tenantId);
  const insights = await generateInsights(tenantId);

  const now = new Date();
  let periodStart: Date;
  let periodLabel: string;

  switch (type) {
    case "daily":
      periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      periodLabel = now.toLocaleDateString("uk-UA");
      break;
    case "weekly":
      periodStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      periodLabel = `${periodStart.toLocaleDateString("uk-UA")} — ${now.toLocaleDateString("uk-UA")}`;
      break;
    case "monthly":
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodLabel = `${periodStart.toLocaleDateString("uk-UA")} — ${now.toLocaleDateString("uk-UA")}`;
      break;
  }

  const content = `
    <h1>${type === "daily" ? "Щоденний" : type === "weekly" ? "Тижневий" : "Місячний"} звіт MARQ</h1>
    <p>Період: ${periodLabel}</p>

    <h2>Виручка</h2>
    <ul>
      <li>Сьогодні: ${Math.round(metrics.revenue.today / 100)} ₴</li>
      <li>Тиждень: ${Math.round(metrics.revenue.week / 100)} ₴</li>
      <li>Місяць: ${Math.round(metrics.revenue.month / 100)} ₴</li>
    </ul>

    <h2>Клієнти</h2>
    <ul>
      <li>Всього: ${metrics.customers.total}</li>
      <li>Нові: ${metrics.customers.new}</li>
      <li>Активні: ${metrics.customers.active}</li>
    </ul>

    <h2>Insights</h2>
    <ul>
      ${insights.map((i) => `<li><strong>${i.metric}</strong>: ${i.recommendation}</li>`).join("")}
    </ul>
  `;

  return {
    id: `${type}-${Date.now()}`,
    type,
    title: `${type === "daily" ? "Щоденний" : type === "weekly" ? "Тижневий" : "Місячний"} звіт`,
    period: periodLabel,
    generated_at: now.toISOString(),
    content,
    metrics: {
      revenue_today: metrics.revenue.today,
      revenue_week: metrics.revenue.week,
      revenue_month: metrics.revenue.month,
      customers_total: metrics.customers.total,
      customers_new: metrics.customers.new,
    },
  };
}
