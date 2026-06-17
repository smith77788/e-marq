/**
 * Smart Product Widget — віджети для вітрини з персоналізованими рекомендаціями.
 *
 * Типи віджетів:
 * 1. Recently Viewed — нещодавно переглянуті
 * 2. Recommended For You — персоналізовані
 * 3. Best Sellers — найпопулярніші
 * 4. New Arrivals — новинки
 * 5. Discounted — зі знижкою
 * 6. Trending — тренди
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProductWidget = {
  type: string;
  title: string;
  products: Array<{
    id: string;
    name: string;
    price_cents: number;
    image_url: string | null;
    badge?: string;
  }>;
};

/**
 * Отримати віджет "Best Sellers".
 */
export async function getBestSellersWidget(
  tenantId: string,
  limit: number = 8,
): Promise<ProductWidget> {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: sales } = await supabaseAdmin
    .from("order_items")
    .select("product_id, product_name, unit_price_cents")
    .eq("tenant_id", tenantId)
    .gte("created_at", monthAgo)
    .limit(1000);

  if (!sales || sales.length === 0) {
    return { type: "best_sellers", title: "Бестселери", products: [] };
  }

  // Порахувати частоту
  const freq: Record<string, { name: string; price: number; count: number }> = {};
  for (const s of sales) {
    if (!freq[s.product_id]) {
      freq[s.product_id] = { name: s.product_name, price: s.unit_price_cents, count: 0 };
    }
    freq[s.product_id].count++;
  }

  const topProducts = Object.entries(freq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([id, data]) => ({
      id,
      name: data.name,
      price_cents: data.price,
      image_url: null as string | null,
      badge: "Бестселер",
    }));

  return { type: "best_sellers", title: "Бестселери місяця", products: topProducts };
}

/**
 * Отримати віджет "New Arrivals".
 */
export async function getNewArrivalsWidget(
  tenantId: string,
  limit: number = 8,
): Promise<ProductWidget> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, image_url")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .gte("created_at", weekAgo)
    .gt("stock", 0)
    .order("created_at", { ascending: false })
    .limit(limit);

  return {
    type: "new_arrivals",
    title: "Новинки",
    products: (products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price_cents: p.price_cents,
      image_url: p.image_url,
      badge: "Новинка",
    })),
  };
}

/**
 * Отримати віджет "Discounted".
 */
export async function getDiscountedWidget(
  tenantId: string,
  limit: number = 8,
): Promise<ProductWidget> {
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, compare_at_price_cents, image_url")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .gt("stock", 0)
    .not("compare_at_price_cents", "is", null)
    .limit(50);

  if (!products) return { type: "discounted", title: "Зі знижкою", products: [] };

  // Фільтрувати тільки зі знижкою
  const discounted = products
    .filter((p) => p.compare_at_price_cents && p.compare_at_price_cents > p.price_cents)
    .sort((a, b) => {
      const discA = a.compare_at_price_cents ? (a.compare_at_price_cents - a.price_cents) / a.compare_at_price_cents : 0;
      const discB = b.compare_at_price_cents ? (b.compare_at_price_cents - b.price_cents) / b.compare_at_price_cents : 0;
      return discB - discA;
    })
    .slice(0, limit)
    .map((p) => {
      const discount = p.compare_at_price_cents
        ? Math.round(((p.compare_at_price_cents - p.price_cents) / p.compare_at_price_cents) * 100)
        : 0;
      return {
        id: p.id,
        name: p.name,
        price_cents: p.price_cents,
        image_url: p.image_url,
        badge: `−${discount}%`,
      };
    });

  return { type: "discounted", title: "Знижки", products: discounted };
}
