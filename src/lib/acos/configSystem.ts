/**
 * Smart Config System — централізована система конфігурації.
 *
 * Типи конфігурацій:
 * 1. Tenant Config — конфігурація тенанта
 * 2. System Config — системна конфігурація
 * 3. Feature Flags — прапорці функцій
 * 4. API Keys — ключі API
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Отримати конфігурацію тенанта.
 */
export async function getTenantConfig(
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return (data?.features as Record<string, unknown>) ?? null;
}

/**
 * Оновити конфігурацію тенанта.
 */
export async function updateTenantConfig(
  tenantId: string,
  updates: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  const current = await getTenantConfig(tenantId);

  const { error } = await supabaseAdmin
    .from("tenant_configs")
    .update({
      features: { ...current, ...updates },
    })
    .eq("tenant_id", tenantId);

  return { ok: !error };
}

/**
 * Перевірити feature flag.
 */
export async function isFeatureEnabled(
  tenantId: string,
  feature: string,
): Promise<boolean> {
  const config = await getTenantConfig(tenantId);
  if (!config) return false;

  const features = (config.features ?? {}) as Record<string, unknown>;
  return features[feature] === true;
}

/**
 * Увімкнути feature flag.
 */
export async function enableFeature(
  tenantId: string,
  feature: string,
): Promise<{ ok: boolean }> {
  const config = await getTenantConfig(tenantId);
  const features = (config?.features ?? {}) as Record<string, unknown>;

  return updateTenantConfig(tenantId, {
    features: { ...features, [feature]: true },
  });
}

/**
 * Вимкнути feature flag.
 */
export async function disableFeature(
  tenantId: string,
  feature: string,
): Promise<{ ok: boolean }> {
  const config = await getTenantConfig(tenantId);
  const features = (config?.features ?? {}) as Record<string, unknown>;

  return updateTenantConfig(tenantId, {
    features: { ...features, [feature]: false },
  });
}
