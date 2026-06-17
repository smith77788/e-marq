/**
 * Smart Review Collection — автоматичний збір відгуків після покупки.
 *
 * Алгоритм:
 * 1. Надіслати запит через 7 днів після покупки
 * 2. Надіслати нагадування через 14 днів
 * 3. Запропонувати бонус за відгук
 * 4. Публікувати найкращі відгуки на сайті
 *
 * Очікуваний ефект: +30% до кількості відгуків.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Знайти клієнтів, яким потрібно надіслати запит відгуку.
 */
export async function getReviewRequestCandidates(
  tenantId: string,
): Promise<Array<{
  customer_id: string;
  customer_email: string;
  order_id: string;
  days_since_order: number;
  already_reviewed: boolean;
}>> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

  // Замовлення 7-14 днів тому
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, customer_email, customer_user_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", twoWeeksAgo)
    .lte("created_at", weekAgo)
    .limit(100);

  if (!orders) return [];

  const candidates = [];
  for (const order of orders) {
    const daysSince = Math.floor(
      (Date.now() - new Date(order.created_at).getTime()) / (24 * 3600 * 1000),
    );

    // Перевірити чи вже є відгук
    const { count: reviewCount } = await supabaseAdmin
      .from("ugc_items")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("customer_id", order.customer_user_id ?? "");

    candidates.push({
      customer_id: order.customer_user_id ?? "",
      customer_email: order.customer_email ?? "",
      order_id: order.id,
      days_since_order: daysSince,
      already_reviewed: (reviewCount ?? 0) > 0,
    });
  }

  return candidates.filter((c) => !c.already_reviewed);
}

/**
 * Оцінити відгук (sentiment analysis).
 */
export async function analyzeReviewSentiment(
  reviewText: string,
): Promise<{ sentiment: "positive" | "neutral" | "negative"; score: number }> {
  // Простий sentiment analysis
  const positiveWords = ["чудово", "якісно", "задоволений", "рекомендую", "швидко", "дякую", "прекрасно", "відмінно"];
  const negativeWords = ["погано", "повільно", "зламано", "жахливо", "повернення", "дефект", "розчарований"];

  const lower = reviewText.toLowerCase();
  const positiveCount = positiveWords.filter((w) => lower.includes(w)).length;
  const negativeCount = negativeWords.filter((w) => lower.includes(w)).length;

  const score = (positiveCount - negativeCount) / Math.max(positiveCount + negativeCount, 1);

  if (score > 0.2) return { sentiment: "positive", score };
  if (score < -0.2) return { sentiment: "negative", score };
  return { sentiment: "neutral", score };
}
