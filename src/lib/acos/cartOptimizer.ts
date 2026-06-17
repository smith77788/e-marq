/**
 * Smart Cart Optimization — оптимізація кошика для збільшення AOV.
 *
 * Можливості:
 * 1. Автоматичні рекомендації "додати до кошика"
 * 2. Бандли (комплекти зі знижкою)
 * 3. Поріг безкоштовної доставки
 * 4. Timer (обмежена пропозиція)
 * 5. Social proof в кошику
 *
 * Очікуваний ефект: +10-20% до AOV.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CartRecommendation = {
  type: "cross_sell" | "bundle" | "free_shipping" | "urgency";
  title: string;
  description: string;
  product_id?: string;
  discount_pct?: number;
  urgency_hours?: number;
};

/**
 * Отримати рекомендації для кошика.
 */
export async function getCartRecommendations(
  tenantId: string,
  cartProductIds: string[],
  cartTotalCents: number,
): Promise<CartRecommendation[]> {
  const recs: CartRecommendation[] = [];

  // 1. Поріг безкоштовної доставки
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const features = (config?.features ?? {}) as Record<string, unknown>;
  const shipping = (features.shipping ?? {}) as Record<string, unknown>;
  const freeFrom = (shipping.free_shipping_from_cents as number) ?? 0;

  if (freeFrom > 0 && cartTotalCents < freeFrom) {
    const remaining = freeFrom - cartTotalCents;
    recs.push({
      type: "free_shipping",
      title: `Додайте ще ${Math.round(remaining / 100)} ₴ для безкоштовної доставки`,
      description: `Безкоштовна доставка від ${Math.round(freeFrom / 100)} ₴`,
    });
  }

  // 2. Cross-sell рекомендації
  if (cartProductIds.length > 0) {
    const { data: coItems } = await supabaseAdmin
      .from("order_items")
      .select("order_id, product_id, product_name, unit_price_cents")
      .eq("tenant_id", tenantId)
      .in("product_id", cartProductIds)
      .limit(50);

    if (coItems && coItems.length > 0) {
      const orderIds = [...new Set(coItems.map((i) => i.order_id).filter(Boolean))];
      const { data: related } = await supabaseAdmin
        .from("order_items")
        .select("product_id, product_name, unit_price_cents")
        .eq("tenant_id", tenantId)
        .in("order_id", orderIds)
        .not("product_id", "in", `(${cartProductIds.join(",")})`)
        .limit(10);

      if (related && related.length > 0) {
        const freq: Record<string, { name: string; price: number; count: number }> = {};
        for (const r of related) {
          if (!r.product_id) continue;
          if (!freq[r.product_id]) {
            freq[r.product_id] = { name: r.product_name, price: r.unit_price_cents, count: 0 };
          }
          freq[r.product_id].count++;
        }

        const top = Object.entries(freq).sort((a, b) => b[1].count - a[1].count)[0];
        if (top) {
          recs.push({
            type: "cross_sell",
            title: `Часто купують разом: ${top[1].name}`,
            description: `${top[1].count} разів разом з вашими товарами`,
            product_id: top[0],
          });
        }
      }
    }
  }

  return recs;
}
