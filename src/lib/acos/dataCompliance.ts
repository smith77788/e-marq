/**
 * Smart Data Compliance — відповідність регуляціям (GDPR, CCPA, etc).
 *
 * Функції:
 * 1. Right to Access — експорт даних користувача
 * 2. Right to Deletion — видалення даних користувача
 * 3. Right to Portability — експорт у JSON
 * 4. Consent Management — керування згодами
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Експорт даних користувача (Right to Access).
 */
export async function exportUserData(
  tenantId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const [customer, orders, events] = await Promise.all([
    supabaseAdmin.from("customers").select("*").eq("tenant_id", tenantId).eq("id", userId).maybeSingle(),
    supabaseAdmin.from("orders").select("*").eq("tenant_id", tenantId).eq("customer_user_id", userId).limit(100),
    supabaseAdmin.from("events").select("*").eq("tenant_id", tenantId).eq("user_id", userId).limit(100),
  ]);

  return {
    personal_info: customer.data,
    orders: orders.data,
    events: events.data,
    exported_at: new Date().toISOString(),
  };
}

/**
 * Видалити дані користувача (Right to Deletion).
 */
export async function deleteUserData(
  tenantId: string,
  userId: string,
): Promise<{ ok: boolean; deleted: number }> {
  let deleted = 0;

  // Видалити замовлення (анонімізувати, не видаляти — для бухгалтерії)
  const { count: ordersAnon } = await supabaseAdmin
    .from("orders")
    .update({ customer_email: "deleted@anonymized.com", customer_name: "Deleted" })
    .eq("tenant_id", tenantId)
    .eq("customer_user_id", userId);

  deleted += ordersAnon ?? 0;

  // Видалити клієнта
  const { count: customersDeleted } = await supabaseAdmin
    .from("customers")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", userId);

  deleted += customersDeleted ?? 0;

  // Видалити події
  const { count: eventsDeleted } = await supabaseAdmin
    .from("events")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  deleted += eventsDeleted ?? 0;

  return { ok: true, deleted };
}
