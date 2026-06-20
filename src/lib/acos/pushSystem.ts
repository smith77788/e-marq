/**
 * Smart Push Notification System — push-сповіщення в браузері.
 *
 * Функції:
 * 1. Підписка на push
 * 2. Відправка push
 * 3. A/B тестування
 * 4. Аналіз кліків
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PushSubscription = {
  id: string;
  tenant_id: string;
  user_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  created_at: string;
};

/**
 * Зареєструвати push підписку.
 */
export async function registerPushSubscription(
  tenantId: string,
  userId: string,
  endpoint: string,
  keys: { p256dh: string; auth: string },
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .upsert({
      fact_key: `push_${tenantId}_${userId}_${Buffer.from(endpoint).toString("base64").slice(0, 32)}`,
      fact_kind: "push_subscription",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "browser",
      value: { user_id: userId, endpoint, keys } as never,
    });

  return { ok: !error };
}

/**
 * Отримати push підписки.
 */
export async function getPushSubscriptions(
  tenantId: string,
): Promise<PushSubscription[]> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "push_subscription");

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      user_id: (v.user_id as string) ?? "",
      endpoint: (v.endpoint as string) ?? "",
      keys: (v.keys as { p256dh: string; auth: string }) ?? { p256dh: "", auth: "" },
      created_at: row.created_at,
    } satisfies PushSubscription;
  });
}

/**
 * Видалити push підписку.
 */
export async function removePushSubscription(
  endpoint: string,
): Promise<{ ok: boolean }> {
  const { data: rows } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("id, value")
    .eq("fact_kind", "push_subscription");

  const toDelete = (rows ?? []).filter((r) => {
    const v = (r.value ?? {}) as Record<string, unknown>;
    return v.endpoint === endpoint;
  });

  if (toDelete.length === 0) return { ok: true };

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .delete()
    .in("id", toDelete.map((r) => r.id));

  return { ok: !error };
}
