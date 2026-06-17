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

  // Heuristic churn scoring (no AI credits needed for large batches).
  // AI is called only for borderline cases (score 30-70) when enabled.
  const BATCH_AI_LIMIT = 20;
  let aiCallsUsed = 0;

  for (const c of customers) {
    const daysSinceLastOrder = c.last_order_at
      ? Math.floor((now - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000))
      : 999;

    // Heuristic score: deterministic, fast, zero cost
    const factors: string[] = [];
    let score = 0;

    if (daysSinceLastOrder > 90) { score += 40; factors.push("Не купував понад 90 днів"); }
    else if (daysSinceLastOrder > 60) { score += 25; factors.push("Не купував понад 60 днів"); }
    else if (daysSinceLastOrder > 30) { score += 10; factors.push("Не купував понад 30 днів"); }

    if (c.total_orders <= 1) { score += 20; factors.push("Лише одна покупка"); }
    else if (c.total_orders <= 2) score += 10;

    if (c.total_spent_cents < 50000) { score += 10; factors.push("Невисокий LTV"); }

    const heuristicProb = Math.min(score / 100, 0.95);

    // For borderline cases, ask AI (up to BATCH_AI_LIMIT calls per batch)
    if (isAnyAiEnabled() && score >= 25 && score <= 65 && aiCallsUsed < BATCH_AI_LIMIT) {
      aiCallsUsed++;
      const result = await aiChat({
        system: `You are a churn prediction model. Output ONLY valid JSON: {"probability": 0.0-1.0, "factors": ["string"]}. No other text.`,
        user: `Orders: ${c.total_orders}\nSpent: ${c.total_spent_cents / 100} UAH\nDays since last order: ${daysSinceLastOrder}\nHeuristic score: ${score}/100`,
        temperature: 0.1,
      });

      try {
        const parsed = JSON.parse(result.content ?? "{}") as { probability?: number; factors?: string[] };
        results.push({
          customer_id: c.id,
          churn_probability: typeof parsed.probability === "number"
            ? Math.max(0, Math.min(1, parsed.probability))
            : heuristicProb,
          factors: Array.isArray(parsed.factors) && parsed.factors.length > 0 ? parsed.factors : factors,
        });
        continue;
      } catch {
        /* fall through to heuristic */
      }
    }

    results.push({ customer_id: c.id, churn_probability: heuristicProb, factors });
  }

  return results;
}
