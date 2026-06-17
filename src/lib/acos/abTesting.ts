/**
 * Smart A/B Testing — автоматичне тестування елементів вітрини
 * для максимізації конверсії.
 *
 Тестовані елементи:
 * 1. Hero заголовок та CTA
 * 2. Цінові пропозиції
 * 3. Позиція товарів
 * 4. Тексти кнопок
 * 5. Кольори
 *
 * Алгоритм:
 * 1. Розподіл трафіку 50/50
 * 2. Збір даних (конверсія, AOV)
 * 3. Статистично значущий результат (p < 0.05)
 * 4. Автоматичне застосування переможця
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AbTest = {
  id: string;
  tenant_id: string;
  name: string;
  status: "running" | "paused" | "completed";
  variant_a: AbVariant;
  variant_b: AbVariant;
  traffic_split: number; // 0-100, percentage for variant A
  winner?: "a" | "b";
  started_at: string;
  ended_at?: string;
};

type AbVariant = {
  id: string;
  name: string;
  config: Record<string, unknown>;
};

type AbResult = {
  variant: "a" | "b";
  visitors: number;
  conversions: number;
  conversion_rate: number;
  revenue_cents: number;
  avg_order_cents: number;
};

/**
 * Створити A/B тест.
 */
export async function createAbTest(
  tenantId: string,
  name: string,
  variantA: AbVariant,
  variantB: AbVariant,
): Promise<AbTest | null> {
  const { data, error } = await supabaseAdmin
    .from("ab_tests")
    .insert({
      tenant_id: tenantId,
      name,
      status: "running",
      variant_a: variantA,
      variant_b: variantB,
      traffic_split: 50,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) return null;
  return data as unknown as AbTest;
}

/**
 * Визначити який варіант показувати користувачу.
 */
export function assignVariant(test: AbTest, userId: string): "a" | "b" {
  // Детермінований розподіл на основі userId
  const hash = simpleHash(userId + test.id);
  return hash % 100 < test.traffic_split ? "a" : "b";
}

/**
 * Записати конверсію.
 */
export async function trackConversion(
  testId: string,
  variant: "a" | "b",
  userId: string,
  orderCents: number,
): Promise<void> {
  await supabaseAdmin.from("ab_tests").select("*").eq("id", testId).single();
  // TODO: Store conversion in ab_test_results table
  console.log(`[AB] ${testId} variant=${variant} conversion=${orderCents}cents`);
}

/**
 * Отримати результати тесту.
 */
export async function getAbTestResults(
  testId: string,
): Promise<{ a: AbResult; b: AbResult } | null> {
  // TODO: Implement from ab_test_results table
  return null;
}

/**
 * Визначити переможця (статистично значущий).
 */
export function determineWinner(a: AbResult, b: AbResult): "a" | "b" | null {
  if (a.visitors < 100 || b.visitors < 100) return null; // Недостатньо даних

  // Z-test for proportions
  const pA = a.conversion_rate;
  const pB = b.conversion_rate;
  const nA = a.visitors;
  const nB = b.visitors;

  const pPooled = (a.conversions + b.conversions) / (nA + nB);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / nA + 1 / nB));

  if (se === 0) return null;

  const z = (pA - pB) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  if (pValue < 0.05) {
    return pA > pB ? "a" : "b";
  }
  return null;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}
