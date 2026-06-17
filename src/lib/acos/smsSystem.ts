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
    .from("bootstrap_facts")
    .insert({
      fact_key: `sms_campaign_${tenantId}_${Date.now()}`,
      fact_kind: "sms_campaign",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "sms_system",
      value: {
        name,
        message,
        segment,
        status: "draft",
        stats: { sent: 0, delivered: 0, failed: 0 },
      } as never,
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
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "sms_campaign")
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: (v.name as string) ?? "",
      message: (v.message as string) ?? "",
      segment: (v.segment as string) ?? "all",
      status: (v.status as SmsCampaign["status"]) ?? "draft",
      stats: (v.stats as SmsCampaign["stats"]) ?? { sent: 0, delivered: 0, failed: 0 },
    } satisfies SmsCampaign;
  });
}
