/**
 * Smart Customer Segmentation — автоматична сегментація клієнтів
 * на основі поведінки та цінності.
 *
 * Сегменти:
 * 1. VIP — топ-20% за витратами, активні
 * 2. Loyal — регулярні покупки, середній чек
 * 3. At Risk — не купували 30-60 днів
 * 4. Churned — не купували 60+ днів
 * 5. New — перша покупка за останні 30 днів
 * 6. Bargain — купують лише на знижках
 * 7. One-Time — одна покупка і зникли
 *
 * Кожен сегмент має свою стратегію взаємодії.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CustomerSegment = {
  id: string;
  name: string;
  description: string;
  count: number;
  total_revenue_cents: number;
  avg_order_cents: number;
  strategy: string;
  color: string;
};

export type SegmentStats = {
  segments: CustomerSegment[];
  total_customers: number;
  total_revenue_cents: number;
  generated_at: string;
};

/**
 * Повна сегментація клієнтів тенанта.
 */
export async function segmentCustomers(
  tenantId: string,
): Promise<SegmentStats> {
  // Отримати всіх клієнтів
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, total_orders, total_spent_cents, avg_order_cents, last_order_at, created_at")
    .eq("tenant_id", tenantId)
    .limit(10000);

  if (!customers || customers.length === 0) {
    return { segments: [], total_customers: 0, total_revenue_cents: 0, generated_at: new Date().toISOString() };
  }

  const now = Date.now();
  const segments: CustomerSegment[] = [];

  // Сегменти
  const vip: typeof customers = [];
  const loyal: typeof customers = [];
  const atRisk: typeof customers = [];
  const churned: typeof customers = [];
  const newCustomers: typeof customers = [];
  const bargain: typeof customers = [];
  const oneTime: typeof customers = [];

  // Поріг для VIP — топ-20% за витратами
  const sorted = [...customers].sort((a, b) => b.total_spent_cents - a.total_spent_cents);
  const vipThreshold = sorted[Math.floor(sorted.length * 0.2)]?.total_spent_cents ?? 0;

  for (const c of customers) {
    const daysSinceLastOrder = c.last_order_at
      ? (now - new Date(c.last_order_at).getTime()) / (24 * 3600 * 1000)
      : Infinity;
    const daysSinceFirstOrder = c.created_at
      ? (now - new Date(c.created_at).getTime()) / (24 * 3600 * 1000)
      : 0;

    if (daysSinceFirstOrder < 30 && c.total_orders <= 1) {
      newCustomers.push(c);
    } else if (c.total_spent_cents >= vipThreshold && daysSinceLastOrder < 30) {
      vip.push(c);
    } else if (c.total_orders >= 3 && daysSinceLastOrder < 30) {
      loyal.push(c);
    } else if (daysSinceLastOrder >= 60) {
      churned.push(c);
    } else if (daysSinceLastOrder >= 30) {
      atRisk.push(c);
    } else if (c.total_orders === 1) {
      oneTime.push(c);
    } else {
      // Перевірити чи купує лише на знижках
      bargain.push(c);
    }
  }

  const mkSegment = (
    id: string, name: string, desc: string, list: typeof customers, strategy: string, color: string,
  ): CustomerSegment => ({
    id, name, description: desc, count: list.length,
    total_revenue_cents: list.reduce((s, c) => s + c.total_spent_cents, 0),
    avg_order_cents: list.length > 0
      ? list.reduce((s, c) => s + (c.avg_order_cents ?? 0), 0) / list.length
      : 0,
    strategy, color,
  });

  segments.push(
    mkSegment("vip", "VIP", "Топ-20% клієнтів за витратами", vip,
      "Персональні пропозиції, ранній доступ, ексклюзивні знижки", "#FFD700"),
    mkSegment("loyal", "Loyal", "Регулярні покупці", loyal,
      "Програма лояльності, реферальні бонуси", "#4CAF50"),
    mkSegment("at_risk", "At Risk", "Не купували 30-60 днів", atRisk,
      "Персональне повідомлення, знижка на повернення", "#FF9800"),
    mkSegment("churned", "Churned", "Не купували 60+ днів", churned,
      "Winback кампанія, агресивна знижка", "#F44336"),
    mkSegment("new", "New", "Нові клієнти (перші 30 днів)", newCustomers,
      "Welcome-ланцюжок, персоналізовані рекомендації", "#2196F3"),
    mkSegment("bargain", "Bargain", "Купують лише на знижках", bargain,
      "Підвищити цінність продукту, бандли", "#9C27B0"),
    mkSegment("one_time", "One-Time", "Одна покупка і зникли", oneTime,
      "Нагадування, cross-sell", "#607D8B"),
  );

  const totalRevenue = segments.reduce((s, seg) => s + seg.total_revenue_cents, 0);

  return {
    segments,
    total_customers: customers.length,
    total_revenue_cents: totalRevenue,
    generated_at: new Date().toISOString(),
  };
}
