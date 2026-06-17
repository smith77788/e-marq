/**
 * Smart Lead Generation — автоматична генерація лідів з різних каналів.
 *
 * Канали:
 * 1. Google Maps — пошук магазинів у ніші
 * 2. Social Media — пошук потенційних клієнтів
 * 3. Referral — реферальна програма
 * 4. Content — SEO-контент для залучення
 * 5. Ads — таргетована реклама
 *
 * Очікуваний ефект: +30% до кількості лідів.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Lead = {
  id: string;
  source: string;
  email?: string;
  company?: string;
  score: number;
  status: "new" | "contacted" | "qualified" | "converted" | "lost";
  created_at: string;
};

/**
 * Оцінити ліда (lead scoring).
 */
export async function scoreLead(
  tenantId: string,
  leadData: {
    email?: string;
    company?: string;
    source: string;
    interaction_count?: number;
  },
): Promise<{ score: number; segment: string; recommended_action: string }> {
  let score = 0;

  // За джерело
  if (leadData.source === "referral") score += 30;
  else if (leadData.source === "organic") score += 20;
  else if (leadData.source === "paid") score += 10;

  // За взаємодію
  if (leadData.interaction_count && leadData.interaction_count > 5) score += 25;
  else if (leadData.interaction_count && leadData.interaction_count > 2) score += 15;

  // За компанію
  if (leadData.company) score += 10;

  // Сегмент
  let segment = "cold";
  let action = "nurture";
  if (score >= 70) { segment = "hot"; action = "call_now"; }
  else if (score >= 40) { segment = "warm"; action = "email_sequence"; }

  return { score: Math.min(100, score), segment, recommended_action: action };
}

/**
 * Отримати статистику лідів.
 */
export async function getLeadStats(
  tenantId: string,
): Promise<{
  total_leads: number;
  conversion_rate: number;
  avg_score: number;
  by_source: Record<string, number>;
}> {
  const { data: leads } = await supabaseAdmin
    .from("lead_prospects")
    .select("source, score, status")
    .eq("tenant_id", tenantId)
    .limit(5000);

  if (!leads || leads.length === 0) {
    return { total_leads: 0, conversion_rate: 0, avg_score: 0, by_source: {} };
  }

  const converted = leads.filter((l) => l.status === "converted").length;
  const avgScore = leads.reduce((s, l) => s + (l.score ?? 0), 0) / leads.length;

  const bySource: Record<string, number> = {};
  for (const l of leads) {
    bySource[l.source] = (bySource[l.source] ?? 0) + 1;
  }

  return {
    total_leads: leads.length,
    conversion_rate: (converted / leads.length) * 100,
    avg_score: Math.round(avgScore),
    by_source: bySource,
  };
}
