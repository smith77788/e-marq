/**
 * Smart Promotion Engine — автоматичне створення та оптимізація промоакцій.
 *
 * Типи промо:
 * 1. Welcome — знижка для нових клієнтів
 * 2. Winback — знижка для тих, хто пішов
 * 3. Upsell — знижка при досягненні суми
 * 4. Seasonal — сезонні акції
 * 5. Flash — швидкі акції з таймером
 *
 * Оптимізація:
 * - Автоматичне визначення оптимальної знижки
 * - A/B тестування розміру знижки
 * - Максимізація маржі при мінімальній знижці
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Promotion = {
  id: string;
  name: string;
  promo_type: string;
  value: number;
  min_order_cents: number;
  usage_limit: number | null;
  times_used: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
};

/**
 * Автоматично створити welcome промо для нового клієнта.
 */
export async function createWelcomePromo(
  tenantId: string,
  customerEmail: string,
): Promise<string | null> {
  const code = `WELCOME-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const { error } = await supabaseAdmin.from("promotions").insert({
    tenant_id: tenantId,
    name: `Welcome ${customerEmail}`,
    code,
    value: 10,
    promo_type: "percentage",
    min_order_cents: 10000,
    usage_limit: 1,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    is_active: true,
    agent: customerEmail,
  });

  if (error) return null;
  return code;
}

/**
 * Автоматично створити winback промо для клієнта, що пішов.
 */
export async function createWinbackPromo(
  tenantId: string,
  customerEmail: string,
  daysInactive: number,
): Promise<string | null> {
  const code = `COMEBACK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  let discountPct = 15;
  if (daysInactive > 90) discountPct = 25;
  else if (daysInactive > 60) discountPct = 20;

  const { error } = await supabaseAdmin.from("promotions").insert({
    tenant_id: tenantId,
    name: `Winback ${customerEmail}`,
    code,
    value: discountPct,
    promo_type: "percentage",
    min_order_cents: 5000,
    usage_limit: 1,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    is_active: true,
    agent: customerEmail,
  });

  if (error) return null;
  return code;
}

/**
 * Отримати активні промо тенанта.
 */
export async function getActivePromotions(
  tenantId: string,
): Promise<Promotion[]> {
  const { data } = await supabaseAdmin
    .from("promotions")
    .select("id, name, promo_type, value, min_order_cents, usage_limit, times_used, starts_at, ends_at, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("starts_at");

  return (data ?? []) as unknown as Promotion[];
}

/**
 * Аналіз ефективності промо.
 */
export async function analyzePromoEffectiveness(
  tenantId: string,
): Promise<{
  total_promos: number;
  total_discount_given_cents: number;
  revenue_from_promos_cents: number;
  roi: number;
}> {
  const { data: promos } = await supabaseAdmin
    .from("promotions")
    .select("id, value, revenue_cents")
    .eq("tenant_id", tenantId);

  if (!promos || promos.length === 0) {
    return { total_promos: 0, total_discount_given_cents: 0, revenue_from_promos_cents: 0, roi: 0 };
  }

  let totalDiscount = 0;
  for (const p of promos) {
    totalDiscount += (p.value ?? 0) * 100;
  }

  return {
    total_promos: promos.length,
    total_discount_given_cents: totalDiscount,
    revenue_from_promos_cents: promos.reduce((s, p) => s + (p.revenue_cents ?? 0), 0),
    roi: totalDiscount > 0 ? promos.reduce((s, p) => s + (p.revenue_cents ?? 0), 0) / totalDiscount : 0,
  };
}
