/**
 * Smart SMS System — централізована система SMS.
 *
 * Функції:
 * 1. Відправка SMS
 * 2. Шаблони SMS
 * 3. A/B тестування
 * 4. Аналіз доставки
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SmsCampaign = {
  id: string;
  tenant_id: string;
  name: string;
  message: string;
  segment: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed";
  stats: {
    sent: number;
    delivered: number;
    failed: number;
  };
};

/**
 * Створити SMS кампанію.
 */
export async function createSmsCampaign(
  tenantId: string,
  name: string,
  message: string,
  segment: string = "all",
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("sms_campaigns")
    .insert({
      tenant_id: tenantId,
      name,
      message,
      segment,
      status: "draft",
      stats: { sent: 0, delivered: 0, failed: 0 },
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати SMS кампанії.
 */
export async function getSmsCampaigns(
  tenantId: string,
): Promise<SmsCampaign[]> {
  const { data } = await supabaseAdmin
    .from("sms_campaigns")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  return (data ?? []) as SmsCampaign[];
}
