/**
 * Smart Notification Preferences — керування налаштуваннями сповіщень.
 *
 * Канали:
 * 1. Email
 * 2. Telegram
 * 3. In-app
 * 4. SMS (майбутнє)
 *
 * Типи сповіщень:
 * 1. Revenue alerts
 * 2. Stock alerts
 * 3. Order updates
 * 4. Agent insights
 * 5. Marketing
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NotificationPreference = {
  tenant_id: string;
  channel: "email" | "telegram" | "in_app";
  type: string;
  enabled: boolean;
  frequency: "instant" | "daily" | "weekly";
};

/**
 * Отримати налаштування сповіщень.
 */
export async function getNotificationPreferences(
  tenantId: string,
): Promise<NotificationPreference[]> {
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const features = (config?.features ?? {}) as Record<string, unknown>;
  const notifications = (features.notifications ?? {}) as Record<string, unknown>;

  // Default preferences
  const defaults: NotificationPreference[] = [
    { tenant_id: tenantId, channel: "email", type: "revenue_alert", enabled: true, frequency: "instant" },
    { tenant_id: tenantId, channel: "email", type: "stock_alert", enabled: true, frequency: "daily" },
    { tenant_id: tenantId, channel: "telegram", type: "revenue_alert", enabled: true, frequency: "instant" },
    { tenant_id: tenantId, channel: "telegram", type: "order_update", enabled: true, frequency: "instant" },
    { tenant_id: tenantId, channel: "in_app", type: "agent_insight", enabled: true, frequency: "instant" },
  ];

  // Override with saved preferences
  for (const d of defaults) {
    const key = `${d.channel}_${d.type}`;
    const saved = notifications[key] as Record<string, unknown> | undefined;
    if (saved) {
      d.enabled = saved.enabled !== false;
      d.frequency = (saved.frequency as NotificationPreference["frequency"]) ?? d.frequency;
    }
  }

  return defaults;
}

/**
 * Оновити налаштування сповіщення.
 */
export async function updateNotificationPreference(
  tenantId: string,
  channel: string,
  type: string,
  enabled: boolean,
  frequency: string,
): Promise<{ ok: boolean }> {
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const features = (config?.features ?? {}) as Record<string, unknown>;
  const notifications = (features.notifications ?? {}) as Record<string, unknown>;

  const key = `${channel}_${type}`;
  const { error } = await supabaseAdmin
    .from("tenant_configs")
    .update({
      features: {
        ...features,
        notifications: {
          ...notifications,
          [key]: { enabled, frequency },
        },
      } as never,
    })
    .eq("tenant_id", tenantId);

  return { ok: !error };
}
