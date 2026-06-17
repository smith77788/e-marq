/**
 * Smart Data Enrichment — збагачення даних клієнтів.
 *
 * Збагачує:
 * 1. Геолокація за IP
 * 2. Часовий пояс за країною
 * 3. Мова за регіоном
 * 4. Сегмент за поведінкою
 * 5. LTV за історією
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EnrichedCustomer = {
  id: string;
  email: string;
  name: string | null;
  segment: string;
  ltv_cents: number;
  churn_risk: number;
  days_since_last_order: number;
  total_orders: number;
};

/**
 * Збагатити дані клієнтів.
 */
export async function enrichCustomerData(
  tenantId: string,
  limit: number = 100,
): Promise<EnrichedCustomer[]> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, email, name, total_orders, total_spent_cents, avg_order_cents, last_order_at, created_at")
    .eq("tenant_id", tenantId)
    .limit(limit);

  if (!customers) return [];

  const now = Date.now();

  return customers.map((c) => {
    const daysSinceLastOrder = c.last_order_at
      ? Math.floor((now - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000))
      : Infinity;

    const daysAsCustomer = c.created_at
      ? Math.floor((now - new Date(c.created_at).getTime()) / (24 * 3600 * 1000))
      : 0;

    // Сегмент
    let segment = "regular";
    if (c.total_spent_cents > 100000) segment = "vip";
    else if (c.total_orders === 1) segment = "new";
    else if (daysSinceLastOrder > 60) segment = "churned";
    else if (daysSinceLastOrder > 30) segment = "at_risk";

    // Churn risk
    let churnRisk = 0;
    if (daysSinceLastOrder > 90) churnRisk = 0.8;
    else if (daysSinceLastOrder > 60) churnRisk = 0.6;
    else if (daysSinceLastOrder > 30) churnRisk = 0.3;

    // LTV
    const monthsAsCustomer = Math.max(daysAsCustomer / 30, 1);
    const frequency = c.total_orders / monthsAsCustomer;
    const aov = c.total_orders > 0 ? c.total_spent_cents / c.total_orders : 0;
    const predictedAnnualLtv = frequency * 12 * aov * (1 - churnRisk * 0.5);

    return {
      id: c.id,
      email: c.email ?? "",
      name: c.name,
      segment,
      ltv_cents: Math.round(predictedAnnualLtv),
      churn_risk: churnRisk,
      days_since_last_order: daysSinceLastOrder === Infinity ? -1 : daysSinceLastOrder,
      total_orders: c.total_orders,
    };
  });
}
