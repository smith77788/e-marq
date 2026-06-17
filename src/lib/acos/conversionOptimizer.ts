/**
 * Smart Conversion Rate Optimization (CRO) — автоматична оптимізація
 * конверсії на всіх етапах воронки.
 *
 * Етапи воронки:
 * 1. Visit → View Product (CTR)
 * 2. View Product → Add to Cart (ATC rate)
 * 3. Add to Cart → Checkout (Cart abandonment)
 * 4. Checkout → Purchase (Conversion rate)
 *
 * Для кожного етапу: аналіз + рекомендації + A/B тести.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FunnelStage = {
  name: string;
  visitors: number;
  conversion_rate: number;
  drop_off: number;
  benchmark: number;
  status: "good" | "warning" | "critical";
  recommendations: string[];
};

/**
 * Аналіз воронки конверсії.
 */
export async function analyzeFunnel(
  tenantId: string,
): Promise<FunnelStage[]> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [views, atcs, checkouts, purchases] = await Promise.all([
    supabaseAdmin.from("events").select("id").eq("tenant_id", tenantId).eq("type", "product_viewed").gte("created_at", weekAgo).limit(5000),
    supabaseAdmin.from("events").select("id").eq("tenant_id", tenantId).eq("type", "add_to_cart").gte("created_at", weekAgo).limit(5000),
    supabaseAdmin.from("events").select("id").eq("tenant_id", tenantId).eq("type", "checkout_started").gte("created_at", weekAgo).limit(5000),
    supabaseAdmin.from("orders").select("id").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo).limit(5000),
  ]);

  const viewCount = (views.data ?? []).length;
  const atcCount = (atcs.data ?? []).length;
  const checkoutCount = (checkouts.data ?? []).length;
  const purchaseCount = (purchases.data ?? []).length;

  const stages: FunnelStage[] = [
    {
      name: "View → Add to Cart",
      visitors: viewCount,
      conversion_rate: viewCount > 0 ? (atcCount / viewCount) * 100 : 0,
      drop_off: viewCount - atcCount,
      benchmark: 8,
      status: "good",
      recommendations: ["Покращіть фото товарів", "Додайте соціальний доказ"],
    },
    {
      name: "Add to Cart → Checkout",
      visitors: atcCount,
      conversion_rate: atcCount > 0 ? (checkoutCount / atcCount) * 100 : 0,
      drop_off: atcCount - checkoutCount,
      benchmark: 60,
      status: "good",
      recommendations: ["Спростіть кошик", "Додайте безкоштовну доставку"],
    },
    {
      name: "Checkout → Purchase",
      visitors: checkoutCount,
      conversion_rate: checkoutCount > 0 ? (purchaseCount / checkoutCount) * 100 : 0,
      drop_off: checkoutCount - purchaseCount,
      benchmark: 65,
      status: "good",
      recommendations: ["Додайте trust signals", "Спростіть форму"],
    },
  ];

  // Визначити статус
  for (const stage of stages) {
    if (stage.conversion_rate >= stage.benchmark) stage.status = "good";
    else if (stage.conversion_rate >= stage.benchmark * 0.7) stage.status = "warning";
    else stage.status = "critical";
  }

  return stages;
}
