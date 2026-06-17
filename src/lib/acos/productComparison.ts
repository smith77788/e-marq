/**
 * Smart Product Comparison — порівняння товарів.
 *
 * Можливості:
 * 1. Порівняння до 4 товарів
 * 2. Виділення найкращого за ціною/якістю
 * 3. Порівняння характеристик
 * 4. Рекомендація найкращого варіанту
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ComparisonProduct = {
  id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  rating?: number;
  review_count?: number;
  in_stock: boolean;
  features: Record<string, string>;
};

/**
 * Отримати товари для порівняння.
 */
export async function getComparisonProducts(
  tenantId: string,
  productIds: string[],
): Promise<ComparisonProduct[]> {
  if (productIds.length === 0 || productIds.length > 4) return [];

  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents, image_url, stock, tags")
    .eq("tenant_id", tenantId)
    .in("id", productIds);

  if (!products) return [];

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    price_cents: p.price_cents,
    image_url: p.image_url,
    in_stock: p.stock > 0,
    features: {
      "Ціна": `${(p.price_cents / 100).toFixed(0)} ₴`,
      "Наявність": p.stock > 0 ? "Є в наявності" : "Немає",
      "Категорія": (p.tags ?? [])[0] ?? "—",
    },
  }));
}

/**
 * Визначити найкращий товар за співвідношенням ціна/якість.
 */
export function recommendBest(comparison: ComparisonProduct[]): string | null {
  if (comparison.length === 0) return null;

  // Простий алгоритм: найнижча ціна + наявність
  const available = comparison.filter((p) => p.in_stock);
  if (available.length === 0) return comparison[0].id;

  return available.sort((a, b) => a.price_cents - b.price_cents)[0].id;
}
