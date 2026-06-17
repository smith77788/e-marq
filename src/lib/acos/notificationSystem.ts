/**
 * Smart Notification System — централізована система сповіщень.
 *
 * Канали:
 * 1. In-app — сповіщення в додатку
 * 2. Email — електронна пошта
 * 3. Telegram — Telegram бот
 * 4. Push — push-сповіщення
 *
 * Типи:
 * 1. Revenue alerts
 * 2. Stock alerts
 * 3. Order updates
 * 4. Agent insights
 * 5. System alerts
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Notification = {
  id: string;
  tenant_id: string;
  type: string;
  title: string;
  body: string;
  channel: "in_app" | "email" | "telegram" | "push";
  read: boolean;
  created_at: string;
};

/**
 * Створити сповіщення.
 */
export async function createNotification(
  tenantId: string,
  type: string,
  title: string,
  body: string,
  channel: Notification["channel"] = "in_app",
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      tenant_id: tenantId,
      type,
      title,
      body,
      channel,
      read: false,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати непрочитані сповіщення.
 */
export async function getUnreadNotifications(
  tenantId: string,
  limit: number = 20,
): Promise<Notification[]> {
  const { data } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as Notification[];
}

/**
 * Позначити сповіщення як прочитане.
 */
export async function markAsRead(
  notificationId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId);

  return { ok: !error };
}

/**
 * Позначити всі як прочитані.
 */
export async function markAllAsRead(
  tenantId: string,
): Promise<{ ok: boolean; count: number }> {
  const { count, error } = await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("tenant_id", tenantId)
    .eq("read", false);

  return { ok: !error, count: count ?? 0 };
}
