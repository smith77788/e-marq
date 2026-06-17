/**
 * Smart Email System — централізована система email.
 *
 * Функції:
 * 1. Відправка email
 * 2. Шаблони email
 * 3. A/B тестування тем
 * 4. Аналіз відкриттів
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EmailCampaign = {
  id: string;
  tenant_id: string;
  name: string;
  subject: string;
  html: string;
  segment: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed";
  scheduled_at?: string;
  sent_at?: string;
  stats: {
    sent: number;
    opened: number;
    clicked: number;
    bounced: number;
    unsubscribed: number;
  };
};

/**
 * Створити email кампанію.
 */
export async function createEmailCampaign(
  tenantId: string,
  name: string,
  subject: string,
  html: string,
  segment: string = "all",
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("email_campaigns")
    .insert({
      tenant_id: tenantId,
      name,
      subject,
      html,
      segment,
      status: "draft",
      stats: { sent: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 },
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати кампанії тенанта.
 */
export async function getEmailCampaigns(
  tenantId: string,
): Promise<EmailCampaign[]> {
  const { data } = await supabaseAdmin
    .from("email_campaigns")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  return (data ?? []) as EmailCampaign[];
}

/**
 * Аналіз ефективності email.
 */
export async function analyzeEmailPerformance(
  tenantId: string,
): Promise<{
  total_campaigns: number;
  avg_open_rate: number;
  avg_click_rate: number;
  best_performing_subject: string;
}> {
  const campaigns = await getEmailCampaigns(tenantId);
  const sent = campaigns.filter((c) => c.status === "sent");

  if (sent.length === 0) {
    return { total_campaigns: 0, avg_open_rate: 0, avg_click_rate: 0, best_performing_subject: "" };
  }

  const totalSent = sent.reduce((s, c) => s + c.stats.sent, 0);
  const totalOpened = sent.reduce((s, c) => s + c.stats.opened, 0);
  const totalClicked = sent.reduce((s, c) => s + c.stats.clicked, 0);

  const bestCampaign = sent.sort(
    (a, b) => (b.stats.opened / Math.max(b.stats.sent, 1)) - (a.stats.opened / Math.max(a.stats.sent, 1)),
  )[0];

  return {
    total_campaigns: sent.length,
    avg_open_rate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100 * 10) / 10 : 0,
    avg_click_rate: totalSent > 0 ? Math.round((totalClicked / totalSent) * 100 * 10) / 10 : 0,
    best_performing_subject: bestCampaign?.subject ?? "",
  };
}
