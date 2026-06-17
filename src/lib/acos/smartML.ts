/**
 * Smart ML — машинне навчання для бізнес-аналітики.
 *
 * Моделі:
 * 1. Churn Prediction — прогноз відтоку
 * 2. Price Optimization — оптимізація цін
 * 3. Demand Forecasting — прогноз попиту
 * 4. Customer Segmentation — сегментація клієнтів
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiChat, isAnyAiEnabled } from "./aiGateway";

/**
 * Прогноз відтоку клієнтів за допомогою AI.
 */
export async function predictChurnWithAI(
  tenantId: string,
): Promise<Array<{
  customer_id: string;
  churn_probability: number;
  factors: string[];
}>> {
  if (!isAnyAiEnabled()) return [];

  // Отримати дані клієнтів
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, total_orders, total_spent_cents, last_order_at")
    .eq("tenant_id", tenantId)
    .limit(100);

  if (!customers || customers.length === 0) return [];

  const results = [];
  const now = Date.now();

  for (const c of customers.slice(0, 10)) {
    const daysSinceLastOrder = c.last_order_at
      ? Math.floor((now - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000))
      : 999;

    const result = await aiChat({
      system: `You are a churn prediction model. Analyze customer data and predict churn probability (0-1). List key factors.`,
      user: `Customer: ${c.name ?? c.email}\nOrders: ${c.total_orders}\nSpent: ${c.total_spent_cents / 100} UAH\nDays since last order: ${daysSinceLastOrder}\n\nPredict churn probability and list factors.`,
      temperature: 0.2,
    });

    try {
      const parsed = JSON.parse(result.content ?? "{}");
      results.push({
        customer_id: c.id,
        churn_probability: parsed.probability ?? 0.5,
        factors: parsed.factors ?? [],
      });
    } catch {
      results.push({
        customer_id: c.id,
        churn_probability: daysSinceLastOrder > 60 ? 0.7 : 0.3,
        factors: [daysSinceLastOrder > 60 ? "Давно не купував" : "Активний клієнт"],
      });
    }
  }

  return results;
}
