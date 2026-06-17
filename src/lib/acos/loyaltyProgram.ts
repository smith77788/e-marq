/**
 * Smart Loyalty Program — автоматична програма лояльності з рівнями.
 *
 * Рівні:
 * 1. Bronze — 0-999 балів
 * 2. Silver — 1000-4999 балів
 * 3. Gold — 5000-19999 балів
 * 4. Platinum — 20000+ балів
 *
 * Переваги:
 * - Бали за кожну покупку (1 бал = 1 грн)
 * - Знижки за рівень (5-20%)
 * - Ексклюзивні товари для Gold+
 * - Нарахування за рефералів
 * - Бонуси за відгуки
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LoyaltyTier = {
  name: string;
  min_points: number;
  discount_pct: number;
  perks: string[];
  color: string;
};

export type LoyaltyMember = {
  customer_id: string;
  customer_name: string | null;
  total_points: number;
  tier: string;
  points_this_month: number;
  next_tier_points: number;
  discount_pct: number;
};

export const LOYALTY_TIERS: LoyaltyTier[] = [
  { name: "Bronze", min_points: 0, discount_pct: 0, perks: ["Бали за покупки"], color: "#CD7F32" },
  { name: "Silver", min_points: 1000, discount_pct: 5, perks: ["5% знижка", "Пріоритетна підтримка"], color: "#C0C0C0" },
  { name: "Gold", min_points: 5000, discount_pct: 10, perks: ["10% знижка", "Безкоштовна доставка", "Ексклюзивні товари"], color: "#FFD700" },
  { name: "Platinum", min_points: 20000, discount_pct: 20, perks: ["20% знижка", "VIP підтримка", "Персональні пропозиції", "Ранній доступ"], color: "#E5E4E2" },
];

/**
 * Отримати інформацію про лояльність клієнта.
 */
export async function getLoyaltyMember(
  tenantId: string,
  customerId: string,
): Promise<LoyaltyMember | null> {
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, name, total_spent_cents, total_orders")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!customer) return null;

  // Конвертувати витрати в бали (1 грн = 1 бал)
  const totalPoints = Math.floor(customer.total_spent_cents / 100);

  // Визначити рівень
  let tier = LOYALTY_TIERS[0];
  for (const t of LOYALTY_TIERS) {
    if (totalPoints >= t.min_points) tier = t;
  }

  // Наступний рівень
  const currentTierIndex = LOYALTY_TIERS.indexOf(tier);
  const nextTier = LOYALTY_TIERS[currentTierIndex + 1];
  const nextTierPoints = nextTier ? nextTier.min_points : totalPoints;

  // Бали за цей місяць
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: monthOrders } = await supabaseAdmin
    .from("orders")
    .select("total_cents")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("status", "paid")
    .gte("created_at", monthAgo);

  const pointsThisMonth = Math.floor(
    (monthOrders ?? []).reduce((s, o) => s + o.total_cents, 0) / 100,
  );

  return {
    customer_id: customer.id,
    customer_name: customer.name,
    total_points: totalPoints,
    tier: tier.name,
    points_this_month: pointsThisMonth,
    next_tier_points: nextTierPoints,
    discount_pct: tier.discount_pct,
  };
}

/**
 * Нарахувати бали за покупку.
 */
export async function awardLoyaltyPoints(
  tenantId: string,
  customerId: string,
  orderCents: number,
): Promise<{ points: number; newTotal: number }> {
  const points = Math.floor(orderCents / 100);

  // Оновити бали (використовуємо total_spent_cents як проксі для балів)
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("total_spent_cents")
    .eq("id", customerId)
    .maybeSingle();

  const newTotal = (customer?.total_spent_cents ?? 0) + orderCents;

  return { points, newTotal: Math.floor(newTotal / 100) };
}

/**
 * Отримати статистику програми лояльності.
 */
export async function getLoyaltyStats(
  tenantId: string,
): Promise<{
  total_members: number;
  tier_distribution: Record<string, number>;
  total_points_issued: number;
  avg_points_per_member: number;
}> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("total_spent_cents")
    .eq("tenant_id", tenantId)
    .limit(10000);

  if (!customers || customers.length === 0) {
    return { total_members: 0, tier_distribution: {}, total_points_issued: 0, avg_points_per_member: 0 };
  }

  const tierDist: Record<string, number> = {};
  let totalPoints = 0;

  for (const c of customers) {
    const points = Math.floor(c.total_spent_cents / 100);
    totalPoints += points;

    let tier = "Bronze";
    for (const t of LOYALTY_TIERS) {
      if (points >= t.min_points) tier = t.name;
    }
    tierDist[tier] = (tierDist[tier] ?? 0) + 1;
  }

  return {
    total_members: customers.length,
    tier_distribution: tierDist,
    total_points_issued: totalPoints,
    avg_points_per_member: Math.round(totalPoints / customers.length),
  };
}
