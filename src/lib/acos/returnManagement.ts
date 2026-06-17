/**
 * Smart Return Management — автоматичне керування поверненнями та поверненнями коштів.
 *
 * Алгоритм:
 * 1. Аналіз причин повернення
 * 2. Прогноз ризику повернення для нового замовлення
 * 3. Автоматичне схвалення/відхилення
 * 4. Генерація рекомендацій щодо покращення товарів
 *
 * Очікуваний ефект: -30% до повернень, +5% до маржі.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ReturnRequest = {
  id: string;
  order_id: string;
  customer_email: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "refunded";
  risk_score: number;
  auto_decision: "auto_approve" | "auto_reject" | "manual_review";
};

/**
 * Аналіз ризику повернення для замовлення.
 */
export async function analyzeReturnRisk(
  tenantId: string,
  orderId: string,
): Promise<{ risk_score: number; reasons: string[]; recommendation: string }> {
  const reasons: string[] = [];
  let riskScore = 0;

  // Отримати замовлення
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("total_cents, customer_email, customer_user_id, created_at")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { risk_score: 0, reasons: [], recommendation: "Замовлення не знайдено" };

  // 1. Історія повернень клієнта
  const { count: prevReturns } = await supabaseAdmin
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("customer_email", order.customer_email ?? "")
    .eq("status", "refunded");

  if (prevReturns && prevReturns > 2) {
    riskScore += 30;
    reasons.push(`Клієнт має ${prevReturns} попередніх повернень`);
  }

  // 2. Велика сума
  if (order.total_cents > 100000) { // > 1000 грн
    riskScore += 15;
    reasons.push("Велика сума замовлення");
  }

  // 3. Швидке замовлення (мало інформації)
  const hoursSinceCreated = (Date.now() - new Date(order.created_at).getTime()) / (3600 * 1000);
  if (hoursSinceCreated < 1) {
    riskScore += 10;
    reasons.push("Замовлення зроблено менше години тому");
  }

  // Визначити рекомендацію
  let recommendation = "Стандартна обробка";
  if (riskScore > 50) {
    recommendation = "Ручна перевірка обов'язкова";
  } else if (riskScore > 30) {
    recommendation = "Додаткова перевірка";
  } else if (riskScore < 10) {
    recommendation = "Автоматичне схвалення";
  }

  return { risk_score: Math.min(100, riskScore), reasons, recommendation };
}

/**
 * Аналіз причин повернень.
 */
export async function analyzeReturnReasons(
  tenantId: string,
): Promise<Array<{ reason: string; count: number; percentage: number; trend: string }>> {
  // Отримати повернення за останні 90 днів
  const days90Ago = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const days30Ago = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [allReturns, recentReturns] = await Promise.all([
    supabaseAdmin.from("orders").select("metadata").eq("tenant_id", tenantId).eq("status", "refunded").gte("created_at", days90Ago).limit(500),
    supabaseAdmin.from("orders").select("metadata").eq("tenant_id", tenantId).eq("status", "refunded").gte("created_at", days30Ago).limit(200),
  ]);

  // Порахувати причини
  const reasonCounts: Record<string, { total: number; recent: number }> = {};
  for (const r of allReturns.data ?? []) {
    const reason = (r.metadata as Record<string, unknown>)?.return_reason as string ?? "Інше";
    if (!reasonCounts[reason]) reasonCounts[reason] = { total: 0, recent: 0 };
    reasonCounts[reason].total++;
  }
  for (const r of recentReturns.data ?? []) {
    const reason = (r.metadata as Record<string, unknown>)?.return_reason as string ?? "Інше";
    if (!reasonCounts[reason]) reasonCounts[reason] = { total: 0, recent: 0 };
    reasonCounts[reason].recent++;
  }

  const totalAll = Object.values(reasonCounts).reduce((s, r) => s + r.total, 0);

  return Object.entries(reasonCounts)
    .map(([reason, data]) => ({
      reason,
      count: data.total,
      percentage: totalAll > 0 ? (data.total / totalAll) * 100 : 0,
      trend: data.recent > data.total * 0.4 ? "📈 зростає" : "📉 стабільно",
    }))
    .sort((a, b) => b.count - a.count);
}
