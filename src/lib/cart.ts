// localStorage cart persistence per tenant
export type CartItem = { quantity: number };
export type Cart = Record<string, CartItem>;

const key = (tenantId: string) => `acos_cart_${tenantId}`;

export function loadCart(tenantId: string): Cart {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Cart) : {};
  } catch {
    return {};
  }
}

export function saveCart(tenantId: string, cart: Cart) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(tenantId), JSON.stringify(cart));
  } catch {
    // ignore quota errors
  }
}

export function clearCart(tenantId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(tenantId));
}
