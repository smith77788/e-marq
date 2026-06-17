/**
 * Smart Integration System — централізована система інтеграцій.
 *
 * Інтеграції:
 * 1. Shopify — e-commerce платформа
 * 2. WooCommerce — WordPress e-commerce
 * 3. Stripe — платежі
 * 4. Resend — email
 * 5. Telegram — месенджер
 * 6. Google Analytics — аналітика
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Integration = {
  id: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  last_sync?: string;
  config: Record<string, unknown>;
};

/**
 * Отримати інтеграції тенанта.
 */
export async function getIntegrations(
  tenantId: string,
): Promise<Integration[]> {
  const { data } = await supabaseAdmin
    .from("tenant_integrations")
    .select("*")
    .eq("tenant_id", tenantId);

  return (data ?? []) as Integration[];
}

/**
 * Підключити інтеграцію.
 */
export async function connectIntegration(
  tenantId: string,
  provider: string,
  config: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("tenant_integrations")
    .upsert({
      tenant_id: tenantId,
      provider,
      status: "connected",
      config,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Відключити інтеграцію.
 */
export async function disconnectIntegration(
  tenantId: string,
  provider: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("tenant_integrations")
    .update({ status: "disconnected" })
    .eq("tenant_id", tenantId)
    .eq("provider", provider);

  return { ok: !error };
}

/**
 * Отримати статус інтеграцій.
 */
export async function getIntegrationStatus(
  tenantId: string,
): Promise<Record<string, string>> {
  const integrations = await getIntegrations(tenantId);
  const status: Record<string, string> = {};

  for (const i of integrations) {
    status[i.provider] = i.status;
  }

  return status;
}
