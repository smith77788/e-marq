/**
 * Helper для email-агентів: перевірити чи власник вмикав цей сценарій.
 *
 * Зчитує `tenant_configs.features.email_automations.{key}`.
 * За замовчуванням всі автоматизації УВІМКНЕНІ (поведінка існуючих агентів
 * не зміниться, поки власник явно не вимкне у /brand/email#automations).
 *
 * Використання:
 *   const enabled = await isEmailAutomationEnabled(tenantId, "abandoned_cart");
 *   if (!enabled) { await finishAgentRun(handle, 0, { reason: "disabled_by_owner" }); ... }
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EmailAutomationKey =
  | "abandoned_cart"
  | "winback"
  | "post_purchase"
  | "order_status"
  | "restock";

export async function isEmailAutomationEnabled(
  tenantId: string,
  key: EmailAutomationKey,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const features = (data?.features ?? {}) as {
    email_automations?: Partial<Record<EmailAutomationKey, boolean>>;
  };
  const stored = features.email_automations?.[key];
  // Default ON: якщо ключ відсутній — увімкнено.
  return stored !== false;
}
