/**
 * Smart Access Control — контроль доступу до даних.
 *
 * Ролі:
 * 1. Owner — повний доступ
 * 2. Admin — управління користувачами
 * 3. Manager — управління товарами/замовленнями
 * 4. Viewer — тільки перегляд
 * 5. Agent — автоматизований доступ
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Permission = {
  resource: string;
  actions: string[];
};

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: [
    { resource: "*", actions: ["*"] },
  ],
  admin: [
    { resource: "users", actions: ["read", "create", "update", "delete"] },
    { resource: "products", actions: ["read", "create", "update", "delete"] },
    { resource: "orders", actions: ["read", "update"] },
    { resource: "analytics", actions: ["read"] },
  ],
  manager: [
    { resource: "products", actions: ["read", "create", "update"] },
    { resource: "orders", actions: ["read", "update"] },
    { resource: "customers", actions: ["read", "update"] },
  ],
  viewer: [
    { resource: "products", actions: ["read"] },
    { resource: "orders", actions: ["read"] },
    { resource: "analytics", actions: ["read"] },
  ],
};

/**
 * Перевірити дозвіл.
 */
export function hasPermission(
  role: string,
  resource: string,
  action: string,
): boolean {
  const permissions = ROLE_PERMISSIONS[role] ?? [];

  for (const p of permissions) {
    if (p.resource === "*" || p.resource === resource) {
      if (p.actions.includes("*") || p.actions.includes(action)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Отримати роль користувача.
 */
export async function getUserRole(
  tenantId: string,
  userId: string,
): Promise<string> {
  const { data: membership } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  return membership?.role ?? "viewer";
}
