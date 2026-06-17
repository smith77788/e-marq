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
    .from("push_subscriptions")
    .upsert({
      tenant_id: tenantId,
      user_id: userId,
      endpoint,
      keys,
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
    .from("push_subscriptions")
    .select("*")
    .eq("tenant_id", tenantId);

  return (data ?? []) as PushSubscription[];
}

/**
 * Видалити push підписку.
 */
export async function removePushSubscription(
  endpoint: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  return { ok: !error };
}
