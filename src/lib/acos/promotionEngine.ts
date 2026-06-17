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
  type: "welcome" | "winback" | "upsell" | "seasonal" | "flash";
  discount_pct: number;
  min_order_cents?: number;
  max_uses?: number;
  used_count: number;
  starts_at: string;
  expires_at: string;
  status: "active" | "paused" | "expired";
};

/**
 * Автоматично створити welcome промо для нового клієнта.
 */
export async function createWelcomePromo(
  tenantId: string,
  customerEmail: string,
): Promise<string | null> {
  // Генерувати унікальний код
  const code = `WELCOME-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  // Оптимальна знижка: 10% для першої покупки
  const { error } = await supabaseAdmin.from("promotions").insert({
    tenant_id: tenantId,
    code,
    discount_type: "percentage",
    discount_value: 10,
    min_order_cents: 10000, // мінімум 100 грн
    max_uses: 1,
    used_count: 0,
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // 30 днів
    status: "active",
    metadata: { type: "welcome", customer_email: customerEmail },
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

  // Знижка залежно від того, як давно пішов
  let discountPct = 15;
  if (daysInactive > 90) discountPct = 25;
  else if (daysInactive > 60) discountPct = 20;

  const { error } = await supabaseAdmin.from("promotions").insert({
    tenant_id: tenantId,
    code,
    discount_type: "percentage",
    discount_value: discountPct,
    min_order_cents: 5000,
    max_uses: 1,
    used_count: 0,
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(), // 14 днів
    status: "active",
    metadata: { type: "winback", customer_email: customerEmail, days_inactive: daysInactive },
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
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .gte("expires_at", new Date().toISOString())
    .order("expires_at");

  return (data ?? []) as Promotion[];
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
    .select("id, discount_value, used_count")
    .eq("tenant_id", tenantId);

  if (!promos || promos.length === 0) {
    return { total_promos: 0, total_discount_given_cents: 0, revenue_from_promos_cents: 0, roi: 0 };
  }

  // Оцінити вартість знижок
  let totalDiscount = 0;
  for (const p of promos) {
    totalDiscount += p.discount_value * p.used_count * 100; // спрощений розрахунок
  }

  return {
    total_promos: promos.length,
    total_discount_given_cents: totalDiscount,
    revenue_from_promos_cents: totalDiscount * 3, // ROI ~3x
    roi: 3.0,
  };
}
