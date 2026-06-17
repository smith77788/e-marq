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
  template: string;
  segment: string;
  status: string;
  scheduled_at?: string;
  sent_at?: string;
  recipients_count: number;
  opens_count: number;
  clicks_count: number;
};

/**
 * Створити email кампанію.
 */
export async function createEmailCampaign(
  tenantId: string,
  name: string,
  subject: string,
  template: string,
  segment: string = "all",
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("email_campaigns")
    .insert({
      tenant_id: tenantId,
      name,
      subject,
      template,
      segment,
      status: "draft",
      recipients_count: 0,
      opens_count: 0,
      clicks_count: 0,
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

  return (data ?? []) as unknown as EmailCampaign[];
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

  const totalSent = sent.reduce((s, c) => s + c.recipients_count, 0);
  const totalOpened = sent.reduce((s, c) => s + c.opens_count, 0);
  const totalClicked = sent.reduce((s, c) => s + c.clicks_count, 0);

  const bestCampaign = sent.sort(
    (a, b) => (b.opens_count / Math.max(b.recipients_count, 1)) - (a.opens_count / Math.max(a.recipients_count, 1)),
  )[0];

  return {
    total_campaigns: sent.length,
    avg_open_rate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100 * 10) / 10 : 0,
    avg_click_rate: totalSent > 0 ? Math.round((totalClicked / totalSent) * 100 * 10) / 10 : 0,
    best_performing_subject: bestCampaign?.subject ?? "",
  };
}
