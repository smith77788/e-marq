/**
 * Smart Data Sync — синхронізація даних між системами.
 *
 * Синхронізує:
 * 1. Shopify → MARQ (товари, замовлення, клієнти)
 * 2. WooCommerce → MARQ (аналогічно)
 * 3. MARQ → Email (клієнти для розсилок)
 * 4. MARQ → Telegram (сповіщення)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SyncResult = {
  synced: number;
  errors: number;
  duration_ms: number;
};

/**
 * Синхронізувати товари з Shopify.
 */
export async function syncShopifyProducts(
  tenantId: string,
): Promise<SyncResult> {
  const start = Date.now();

  // TODO: Викликати Shopify API
  // Поки що повертаємо порожній результат

  return {
    synced: 0,
    errors: 0,
    duration_ms: Date.now() - start,
  };
}

/**
 * Синхронізувати замовлення з Shopify.
 */
export async function syncShopifyOrders(
  tenantId: string,
): Promise<SyncResult> {
  const start = Date.now();

  // TODO: Викликати Shopify API

  return {
    synced: 0,
    errors: 0,
    duration_ms: Date.now() - start,
  };
}

/**
 * Синхронізувати клієнтів з Shopify.
 */
export async function syncShopifyCustomers(
  tenantId: string,
): Promise<SyncResult> {
  const start = Date.now();

  // TODO: Викликати Shopify API

  return {
    synced: 0,
    errors: 0,
    duration_ms: Date.now() - start,
  };
}

/**
 * Отримати статус синхронізації.
 */
export async function getSyncStatus(
  tenantId: string,
): Promise<Array<{
  source: string;
  last_sync: string;
  status: "ok" | "error" | "pending";
  items_synced: number;
}>> {
  const { data: integrations } = await supabaseAdmin
    .from("tenant_integrations")
    .select("*")
    .eq("tenant_id", tenantId);

  return (integrations ?? []).map((i) => ({
    source: i.provider,
    last_sync: i.last_sync_at ?? "",
    status: i.last_sync_status as "ok" | "error" | "pending",
    items_synced: 0,
  }));
}
