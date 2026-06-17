/**
 * Smart A/B Testing — автоматичне тестування елементів вітрини
 * для максимізації конверсії.
 *
 * Тестовані елементи:
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
 *
 * Schema: ab_tests — columns: id, tenant_id, test_key, name, metric, status,
 * variants (JSON), results (JSON), started_at, ended_at, winner_variant.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AbTest = {
  id: string;
  tenant_id: string;
  test_key: string;
  name: string;
  metric: string;
  status: "running" | "paused" | "completed";
  variants: { a: AbVariant; b: AbVariant; traffic_split: number };
  winner_variant?: "a" | "b" | null;
  started_at: string;
  ended_at?: string | null;
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
  testKey: string,
  name: string,
  metric: string,
  variantA: AbVariant,
  variantB: AbVariant,
): Promise<AbTest | null> {
  const { data, error } = await supabaseAdmin
    .from("ab_tests")
    .insert({
      tenant_id: tenantId,
      test_key: testKey,
      name,
      metric,
      status: "running",
      variants: { a: variantA, b: variantB, traffic_split: 50 } as never,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) return null;
  const d = data as typeof data & { variants: AbTest["variants"] };
  return {
    id: d.id,
    tenant_id: d.tenant_id,
    test_key: d.test_key,
    name: d.name,
    metric: d.metric,
    status: d.status as AbTest["status"],
    variants: d.variants,
    started_at: d.started_at,
    ended_at: d.ended_at,
    winner_variant: (d.winner_variant as "a" | "b" | null) ?? null,
  };
}

/**
 * Визначити який варіант показувати користувачу.
 */
export function assignVariant(test: AbTest, userId: string): "a" | "b" {
  const hash = simpleHash(userId + test.id);
  const split = test.variants.traffic_split ?? 50;
  return hash % 100 < split ? "a" : "b";
}

/**
 * Записати конверсію у поле results таблиці ab_tests.
 */
export async function trackConversion(
  testId: string,
  variant: "a" | "b",
  _userId: string,
  orderCents: number,
): Promise<void> {
  const { data: test } = await supabaseAdmin
    .from("ab_tests")
    .select("results")
    .eq("id", testId)
    .single();
  if (!test) return;

  const results = ((test.results as Record<string, unknown>) ?? {}) as {
    a?: { conversions: number; revenue: number; visitors: number };
    b?: { conversions: number; revenue: number; visitors: number };
  };

  const side = results[variant] ?? { conversions: 0, revenue: 0, visitors: 0 };
  side.visitors++;
  if (orderCents > 0) {
    side.conversions++;
    side.revenue += orderCents;
  }
  results[variant] = side;

  await supabaseAdmin
    .from("ab_tests")
    .update({ results: results as never, updated_at: new Date().toISOString() })
    .eq("id", testId);
}

/**
 * Отримати результати тесту.
 */
export async function getAbTestResults(
  testId: string,
): Promise<{ a: AbResult; b: AbResult } | null> {
  const { data: test } = await supabaseAdmin
    .from("ab_tests")
    .select("results")
    .eq("id", testId)
    .single();
  if (!test) return null;

  const raw = ((test.results as Record<string, unknown>) ?? {}) as {
    a?: { conversions: number; revenue: number; visitors: number };
    b?: { conversions: number; revenue: number; visitors: number };
  };

  const toResult = (r: { conversions: number; revenue: number; visitors: number } | undefined, v: "a" | "b"): AbResult => {
    const visitors = r?.visitors ?? 0;
    const conversions = r?.conversions ?? 0;
    const revenue = r?.revenue ?? 0;
    return {
      variant: v,
      visitors,
      conversions,
      conversion_rate: visitors > 0 ? conversions / visitors : 0,
      revenue_cents: revenue,
      avg_order_cents: conversions > 0 ? revenue / conversions : 0,
    };
  };

  return { a: toResult(raw.a, "a"), b: toResult(raw.b, "b") };
}

/**
 * Визначити переможця (статистично значущий Z-test для пропорцій).
 */
export function determineWinner(a: AbResult, b: AbResult): "a" | "b" | null {
  if (a.visitors < 100 || b.visitors < 100) return null;

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
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
