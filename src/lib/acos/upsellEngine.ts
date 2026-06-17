/**
 * Smart Upsell Engine — аналізує поведінку кошика та генерує персоналізовані
 * пропозиції для збільшення середнього чека.
 *
 * Алгоритм:
 * 1. Аналіз товарів у кошику (категорія, ціна, маржа)
 * 2. Пошук комплементарних товарів (market basket analysis)
 * 3. Генерація персоналізованих пропозицій з AI
 * 4. A/B тестування різних пропозицій
 *
 * Очікуваний ефект: +8-15% до середнього чека
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiChat, isAnyAiEnabled } from "./aiGateway";

export type UpsellOffer = {
  product_id: string;
  product_name: string;
  price_cents: number;
  image_url: string | null;
  reason: string;
  discount_pct?: number;
  confidence: number;
};

/**
 * Отримати upsell пропозиції для кошика.
 * Викликається з checkout сторінки або cart sheet.
 */
export async function getUpsellOffers(
  tenantId: string,
  cartProductIds: string[],
  cartTotalCents: number,
): Promise<UpsellOffer[]> {
  if (cartProductIds.length === 0) return [];

  // 1. Знайти комплементарні товари (які часто купують разом)
  const complementary = await findComplementaryProducts(tenantId, cartProductIds, 5);

  // 2. Знайти товари вище за ціну (upsell)
  const upsell = await findUpsellProducts(tenantId, cartProductIds, cartTotalCents, 3);

  // 3. Знайти дешевші добавки (cross-sell)
  const crossSell = await findCrossSellProducts(tenantId, cartProductIds, 3);

  // 4. Об'єднати та відсортувати за confidence
  const allOffers = [...complementary, ...upsell, ...crossSell];
  const unique = deduplicateOffers(allOffers);
  return unique.slice(0, 5);
}

/**
 * Знайти товари, які часто купують разом з поточними.
 */
async function findComplementaryProducts(
  tenantId: string,
  cartProductIds: string[],
  limit: number,
): Promise<UpsellOffer[]> {
  // Знайти замовлення, що містять товари з кошика
  const { data: orders } = await supabaseAdmin
    .from("order_items")
    .select("order_id")
    .eq("tenant_id", tenantId)
    .in("product_id", cartProductIds)
    .limit(100);

  if (!orders || orders.length === 0) return [];

  const orderIds = [...new Set(orders.map((o) => o.order_id))];

  // Знайти інші товари в цих замовленнях
  const { data: coItems } = await supabaseAdmin
    .from("order_items")
    .select("product_id, product_name, unit_price_cents")
    .eq("tenant_id", tenantId)
    .in("order_id", orderIds)
    .not("product_id", "in", `(${cartProductIds.join(",")})`)
    .limit(200);

  if (!coItems || coItems.length === 0) return [];

  // Порахувати частоту кожного товару
  const freq: Record<string, { name: string; price: number; count: number }> = {};
  for (const item of coItems) {
    if (!item.product_id) continue;
    if (!freq[item.product_id]) {
      freq[item.product_id] = { name: item.product_name, price: item.unit_price_cents, count: 0 };
    }
    freq[item.product_id].count++;
  }

  // Відсортувати за частотою та повернути топ
  return Object.entries(freq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([id, data]) => ({
      product_id: id,
      product_name: data.name,
      price_cents: data.price,
      image_url: null,
      reason: `Часто купують разом (${data.count} разів)`,
      confidence: Math.min(0.95, data.count / orderIds.length),
    }));
}

/**
 * Знайти товари дорожчі за поточні (upsell).
 */
async function findUpsellProducts(
  tenantId: string,
  cartProductIds: string[],
  cartTotalCents: number,
  limit: number,
): Promise<UpsellOffer[]> {
  // Знайти товари вище за ціну в кошику, але в тій самій категорії
  const { data: cartProducts } = await supabaseAdmin
    .from("products")
    .select("id, tags, price_cents")
    .eq("tenant_id", tenantId)
    .in("id", cartProductIds);

  if (!cartProducts || cartProducts.length === 0) return [];

  // Отримати теги з кошика
  const cartTags = new Set<string>();
  for (const p of cartProducts) {
    if (p.tags) {
      for (const tag of p.tags) cartTags.add(tag);
    }
  }

  const avgPrice = cartTotalCents / cartProductIds.length;
  const targetMinPrice = avgPrice * 1.5; // +50% від середньої ціни
  const targetMaxPrice = avgPrice * 3; // але не більше 3x

  // Знайти товари вище за ціну
  const { data: upsellCandidates } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, image_url, tags")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .gt("price_cents", targetMinPrice)
    .lte("price_cents", targetMaxPrice)
    .not("id", "in", `(${cartProductIds.join(",")})`)
    .gt("stock", 0)
    .limit(20);

  if (!upsellCandidates || upsellCandidates.length === 0) return [];

  // Фільтрувати за тегами
  const scored = upsellCandidates.map((p) => {
    const productTags = new Set(p.tags ?? []);
    const overlap = [...cartTags].filter((t) => productTags.has(t)).length;
    const tagScore = overlap / Math.max(cartTags.size, 1);
    return {
      product_id: p.id,
      product_name: p.name,
      price_cents: p.price_cents,
      image_url: p.image_url,
      reason: overlap > 0 ? `Схожий товар, але преміум` : `Кращий варіант`,
      confidence: 0.5 + tagScore * 0.3,
    };
  });

  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

/**
 * Знайти дешевші добавки (cross-sell).
 */
async function findCrossSellProducts(
  tenantId: string,
  cartProductIds: string[],
  limit: number,
): Promise<UpsellOffer[]> {
  // Знайти дешеві товари, які доповнюють кошик
  const { data: cheapItems } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, image_url")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .lte("price_cents", 50000) // до 500 грн
    .not("id", "in", `(${cartProductIds.join(",")})`)
    .gt("stock", 0)
    .order("price_cents", { ascending: true })
    .limit(10);

  if (!cheapItems || cheapItems.length === 0) return [];

  return cheapItems.slice(0, limit).map((p) => ({
    product_id: p.id,
    product_name: p.name,
    price_cents: p.price_cents,
    image_url: p.image_url,
    reason: `Дешева добавка до замовлення`,
    confidence: 0.4,
  }));
}

function deduplicateOffers(offers: UpsellOffer[]): UpsellOffer[] {
  const seen = new Set<string>();
  return offers.filter((o) => {
    if (seen.has(o.product_id)) return false;
    seen.add(o.product_id);
    return true;
  });
}

/**
 * Згенерувати AI-powered персоналізовану upsell пропозицію.
 */
export async function generateAiUpsellCopy(
  brandName: string,
  cartItems: Array<{ name: string; price: number }>,
  upsellProduct: string,
  upsellPrice: number,
): Promise<string | null> {
  if (!isAnyAiEnabled()) return null;

  const cartList = cartItems.map((i) => `- ${i.name} (${i.price} грн)`).join("\n");
  const system = `You are a friendly D2C sales assistant for "${brandName}". Write a SHORT (1-2 sentence) upsell suggestion. Be helpful, not pushy. Never say "discount" or "sale" — say "complete your set" or "you might also like". Match the language of the cart items.`;
  const user = `Cart items:\n${cartList}\n\nSuggest: ${upsellProduct} (${upsellPrice} грн)\n\nWrite a natural upsell message.`;

  const result = await aiChat({ system, user, temperature: 0.6 });
  return result.content;
}
