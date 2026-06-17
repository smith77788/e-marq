/**
 * Smart In-App Notification System — сповіщення в додатку.
 *
 * Функції:
 * 1. Toast сповіщення
 * 2. Banner сповіщення
 * 3. Badge лічильник
 * 4. Notification center
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InAppNotification = {
  id: string;
  tenant_id: string;
  user_id: string;
  type: "toast" | "banner" | "badge";
  title: string;
  message: string;
  read: boolean;
  action_url?: string;
  created_at: string;
};

/**
 * Створити in-app сповіщення.
 */
export async function createInAppNotification(
  tenantId: string,
  userId: string,
  type: InAppNotification["type"],
  title: string,
  message: string,
  actionUrl?: string,
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("in_app_notifications")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      type,
      title,
      message,
      read: false,
      action_url: actionUrl,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати непрочитані сповіщення.
 */
export async function getUnreadInAppNotifications(
  tenantId: string,
  userId: string,
): Promise<InAppNotification[]> {
  const { data } = await supabaseAdmin
    .from("in_app_notifications")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []) as InAppNotification[];
}

/**
 * Позначити як прочитане.
 */
export async function markInAppAsRead(
  notificationId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("in_app_notifications")
    .update({ read: true })
    .eq("id", notificationId);

  return { ok: !error };
}

/**
 * Позначити всі як прочитані.
 */
export async function markAllInAppAsRead(
  tenantId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("in_app_notifications")
    .update({ read: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("read", false);

  return { ok: !error };
}

/**
 * Отримати кількість непрочитаних.
 */
export async function getUnreadCount(
  tenantId: string,
  userId: string,
): Promise<number> {
  const { count } = await supabaseAdmin
    .from("in_app_notifications")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("read", false);

  return count ?? 0;
}
