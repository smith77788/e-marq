/**
 * Smart Report Generator — автоматичне створення звітів.
 *
 * Типи звітів:
 * 1. Daily Report — щоденний звіт
 * 2. Weekly Report — тижневий звіт
 * 3. Monthly Report — місячний звіт
 * 4. Custom Report — кастомний звіт
 *
 * Формати: HTML, PDF (майбутнє)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getKeyMetrics, generateInsights } from "./analyticsEngine";

export type Report = {
  id: string;
  type: string;
  period: string;
  generated_at: string;
  html: string;
};

/**
 * Згенерувати щоденний звіт.
 */
export async function generateDailyReport(
  tenantId: string,
): Promise<Report> {
  const metrics = await getKeyMetrics(tenantId);
  const insights = await generateInsights(tenantId);

  const html = `
    <h1>Щоденний звіт MARQ</h1>
    <p>Дата: ${new Date().toLocaleDateString("uk-UA")}</p>

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
    id: `daily-${Date.now()}`,
    type: "daily",
    period: new Date().toISOString().split("T")[0],
    generated_at: new Date().toISOString(),
    html,
  };
}

/**
 * Згенерувати тижневий звіт.
 */
export async function generateWeeklyReport(
  tenantId: string,
): Promise<Report> {
  const metrics = await getKeyMetrics(tenantId);
  const insights = await generateInsights(tenantId);

  const html = `
    <h1>Тижневий звіт MARQ</h1>
    <p>Період: ${new Date(Date.now() - 7 * 24 * 3600 * 1000).toLocaleDateString("uk-UA")} — ${new Date().toLocaleDateString("uk-UA")}</p>

    <h2>Підсумки тижня</h2>
    <ul>
      <li>Виручка: ${Math.round(metrics.revenue.week / 100)} ₴</li>
      <li>Замовлення: ${metrics.customers.active}</li>
      <li>Нові клієнти: ${metrics.customers.new}</li>
      <li>Відтік: ${metrics.customers.churned}</li>
    </ul>

    <h2>Рекомендації на наступний тиждень</h2>
    <ul>
      ${insights.map((i) => `<li><strong>${i.metric}</strong>: ${i.recommendation}</li>`).join("")}
    </ul>
  `;

  return {
    id: `weekly-${Date.now()}`,
    type: "weekly",
    period: `${new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split("T")[0]} — ${new Date().toISOString().split("T")[0]}`,
    generated_at: new Date().toISOString(),
    html,
  };
}
