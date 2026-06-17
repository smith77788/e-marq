/**
 * Smart API Authorization — авторизація API запитів.
 *
 * Рівні доступу:
 * 1. Public — відкритий доступ
 * 2. Authenticated — автентифікований
 * 3. Admin — адміністратор
 * 4. Owner — власник
 */

export type Permission = {
  resource: string;
  action: string;
};

export type Role = {
  name: string;
  permissions: Permission[];
};

const ROLES: Record<string, Role> = {
  public: {
    name: "public",
    permissions: [
      { resource: "storefront", action: "read" },
      { resource: "products", action: "read" },
    ],
  },
  authenticated: {
    name: "authenticated",
    permissions: [
      { resource: "orders", action: "read" },
      { resource: "orders", action: "create" },
      { resource: "customers", action: "read" },
    ],
  },
  admin: {
    name: "admin",
    permissions: [
      { resource: "*", action: "read" },
      { resource: "products", action: "write" },
      { resource: "orders", action: "write" },
      { resource: "customers", action: "write" },
    ],
  },
  owner: {
    name: "owner",
    permissions: [
      { resource: "*", action: "*" },
    ],
  },
};

/**
 * Перевірити дозвіл.
 */
export function hasPermission(
  role: string,
  resource: string,
  action: string,
): boolean {
  const roleConfig = ROLES[role];
  if (!roleConfig) return false;

  return roleConfig.permissions.some(
    (p) =>
      (p.resource === "*" || p.resource === resource) &&
      (p.action === "*" || p.action === action),
  );
}

/**
 * Отримати роль за замовчуванням.
 */
export function getDefaultRole(): string {
  return "public";
}
