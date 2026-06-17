/**
 * Revenue Recovery Engine — знаходить втрачену виручку та автоматично
 * вживає заходів для її повернення.
 *
 * Канали втрат:
 * 1. Покинуті кошики (40-70% кошиків не завершуються)
 * 2. Клієнти, що пішли (churn)
 * 3. Занижені ціни (маржа нижча за ринкову)
 * 4. Прогалини в асортименті (шукати але не знаходити)
 * 5. Низький середній чек (немає апсейлу)
 *
 * Кожен канал має свій скор-модель та пріоритет.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiChat, isAnyAiEnabled } from "./aiGateway";

export type RevenueLeak = {
  channel: "cart_abandonment" | "churn" | "underpricing" | "missing_products" | "low_aov";
  severity: "critical" | "high" | "medium" | "low";
  estimated_loss_cents: number;
  description: string;
  action: string;
  auto_fixable: boolean;
};

export type RevenueRecoveryReport = {
  tenant_id: string;
  total_estimated_loss_cents: number;
  leaks: RevenueLeak[];
  auto_recovery_actions: number;
  generated_at: string;
};

/**
 * Повний аналіз витоків виручки для тенанта.
 */
export async function analyzeRevenueLeaks(
  tenantId: string,
): Promise<RevenueRecoveryReport> {
  const leaks: RevenueLeak[] = [];

  // Паралельний аналіз всіх каналів
  const [cartLeaks, churnLeaks, pricingLeaks, productLeaks, aovLeaks] = await Promise.all([
    analyzeCartAbandonment(tenantId),
    analyzeChurnRevenue(tenantId),
    analyzeUnderpricing(tenantId),
    analyzeMissingProducts(tenantId),
    analyzeLowAOV(tenantId),
  ]);

  leaks.push(...cartLeaks, ...churnLeaks, ...pricingLeaks, ...productLeaks, ...aovLeaks);

  // Сортувати за збитком
  leaks.sort((a, b) => b.estimated_loss_cents - a.estimated_loss_cents);

  const totalLoss = leaks.reduce((sum, l) => sum + l.estimated_loss_cents, 0);
  const autoFixable = leaks.filter((l) => l.auto_fixable).length;

  return {
    tenant_id: tenantId,
    total_estimated_loss_cents: totalLoss,
    leaks,
    auto_recovery_actions: autoFixable,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Аналіз покинутих кошиків.
 */
async function analyzeCartAbandonment(tenantId: string): Promise<RevenueLeak[]> {
  const leaks: RevenueLeak[] = [];

  // Знайти кошики за останні 7 днів
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: abandonedCarts } = await supabaseAdmin
    .from("events")
    .select("payload, created_at")
    .eq("tenant_id", tenantId)
    .eq("type", "checkout_started")
    .gte("created_at", weekAgo)
    .limit(500);

  if (!abandonedCarts || abandonedCarts.length === 0) return leaks;

  // Оцінити втрачену виручку
  let totalLost = 0;
  for (const cart of abandonedCarts) {
    const payload = cart.payload as Record<string, unknown> | null;
    const totalCents = (payload?.total_cents as number) ?? 0;
    totalLost += totalCents;
  }

  if (totalLost > 0) {
    leaks.push({
      channel: "cart_abandonment",
      severity: totalLost > 500000 ? "critical" : totalLost > 100000 ? "high" : "medium",
      estimated_loss_cents: totalLost,
      description: `${abandonedCarts.length} покинутих кошиків на ${formatCents(totalLost)} за тиждень`,
      action: "Надіслати нагадування про покинутий кошик",
      auto_fixable: true,
    });
  }

  return leaks;
}

/**
 * Аналіз втрат від відтоку клієнтів.
 */
async function analyzeChurnRevenue(tenantId: string): Promise<RevenueLeak[]> {
  const leaks: RevenueLeak[] = [];

  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();

  // Клієнти, які купували 3-6 місяців тому, але не зараз
  const { data: churned } = await supabaseAdmin
    .from("customers")
    .select("id, total_spent_cents, avg_order_cents, total_orders")
    .eq("tenant_id", tenantId)
    .gte("last_order_at", sixMonthsAgo)
    .lte("last_order_at", threeMonthsAgo)
    .gte("total_orders", 2)
    .order("total_spent_cents", { ascending: false })
    .limit(100);

  if (!churned || churned.length === 0) return leaks;

  // Оцінити річну втрату
  let annualLoss = 0;
  for (const c of churned) {
    const avgOrder = c.avg_order_cents ?? c.total_spent_cents / c.total_orders;
    const ordersPerYear = c.total_orders >= 4 ? 12 : c.total_orders >= 2 ? 6 : 3;
    annualLoss += avgOrder * ordersPerYear * 0.3; // 30% ймовірність повернення
  }

  if (annualLoss > 0) {
    leaks.push({
      channel: "churn",
      severity: annualLoss > 1000000 ? "critical" : annualLoss > 500000 ? "high" : "medium",
      estimated_loss_cents: annualLoss,
      description: `${churned.length} активних клієнтів пішли (${formatCents(annualLoss)}/рік потенційна втрата)`,
      action: "Запустити winback кампанію з персональними знижками",
      auto_fixable: true,
    });
  }

  return leaks;
}

/**
 * Аналіз занижених цін.
 */
async function analyzeUnderpricing(tenantId: string): Promise<RevenueLeak[]> {
  const leaks: RevenueLeak[] = [];

  // Знайти товари з низькою маржею або ті, що продаються занадто добре
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, stock")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .gt("stock", 0)
    .limit(200);

  if (!products || products.length === 0) return leaks;

  // Знайти товари, які продаються швидко за низьку ціну
  const { data: fastSelling } = await supabaseAdmin
    .from("order_items")
    .select("product_id, product_name, unit_price_cents, quantity")
    .eq("tenant_id", tenantId)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .limit(1000);

  if (!fastSelling || fastSelling.length === 0) return leaks;

  // Порахувати середню ціну продажу для кожного товару
  const avgPrices: Record<string, { total: number; count: number; name: string }> = {};
  for (const item of fastSelling) {
    if (!item.product_id) continue;
    if (!avgPrices[item.product_id]) {
      avgPrices[item.product_id] = { total: 0, count: 0, name: item.product_name };
    }
    avgPrices[item.product_id].total += item.unit_price_cents * item.quantity;
    avgPrices[item.product_id].count += item.quantity;
  }

  // Знайти товари, які продаються більше 10 разів за місяць
  let totalPotential = 0;
  for (const [id, data] of Object.entries(avgPrices)) {
    if (data.count >= 10) {
      // Якщо товар продається швидко — ціна може бути занадто низькою
      const potentialLift = data.total * 0.05; // 5% підвищення ціни
      totalPotential += potentialLift;
    }
  }

  if (totalPotential > 100000) { // більше 1000 грн/міс
    leaks.push({
      channel: "underpricing",
      severity: totalPotential > 500000 ? "high" : "medium",
      estimated_loss_cents: totalPotential,
      description: `Товари з високою швидкістю продажу мають потенціал +5% до ціни`,
      action: "Запустити ціновий оптимізатор для товарів з високим попитом",
      auto_fixable: true,
    });
  }

  return leaks;
}

/**
 * Аналіз прогалин в асортименті.
 */
async function analyzeMissingProducts(tenantId: string): Promise<RevenueLeak[]> {
  const leaks: RevenueLeak[] = [];

  // Знайти пошукові запити з нульовими результатами
  const { data: searches } = await supabaseAdmin
    .from("search_queries")
    .select("query, result_count")
    .eq("tenant_id", tenantId)
    .eq("result_count", 0)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .limit(100);

  if (!searches || searches.length === 0) return leaks;

  // Порахувати загальну кількість пошуків без результатів
  const totalFailedSearches = searches.length;
  if (totalFailedSearches > 10) {
    leaks.push({
      channel: "missing_products",
      severity: totalFailedSearches > 50 ? "high" : "medium",
      estimated_loss_cents: totalFailedSearches * 20000, // ~200 грн за кожен втрачений пошук
      description: `${totalFailedSearches} пошукових запитів без результатів за місяць`,
      action: "Додати товари, які шукають клієнти",
      auto_fixable: false,
    });
  }

  return leaks;
}

/**
 * Аналіз низького середнього чека.
 */
async function analyzeLowAOV(tenantId: string): Promise<RevenueLeak[]> {
  const leaks: RevenueLeak[] = [];

  // Середній чек за останні 30 днів
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: stats } = await supabaseAdmin
    .from("orders")
    .select("total_cents")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .gte("created_at", monthAgo)
    .limit(500);

  if (!stats || stats.length < 10) return leaks;

  const avgOrder = stats.reduce((sum, o) => sum + o.total_cents, 0) / stats.length;

  // Якщо середній чек нижче 500 грн — є потенціал для зростання
  if (avgOrder < 50000) { // < 500 грн
    const potentialLift = avgOrder * 0.15 * stats.length; // +15% до чека
    leaks.push({
      channel: "low_aov",
      severity: avgOrder < 30000 ? "high" : "medium",
      estimated_loss_cents: potentialLift,
      description: `Середній чек ${formatCents(avgOrder)} — нижче ринкового`,
      action: "Додати upsell пропозиції та бандли",
      auto_fixable: true,
    });
  }

  return leaks;
}

function formatCents(cents: number): string {
  const uah = Math.round(cents / 100);
  return `${uah.toLocaleString("uk-UA")} ₴`;
}
