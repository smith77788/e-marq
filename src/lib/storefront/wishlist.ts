/**
 * Storefront wishlist — per-tenant localStorage list of product IDs.
 * Pure client-only; survives across sessions on the same device.
 *
 * Subscribers can listen via `subscribeWishlist` to re-render hearts/badges
 * whenever the wishlist changes (including from another tab via storage event).
 */

export type WishlistState = string[];

const KEY = (tenantId: string) => `acos_wishlist_${tenantId}`;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function loadWishlist(tenantId: string): WishlistState {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as string[]) : [];
  } catch {
    return [];
  }
}

export function saveWishlist(tenantId: string, ids: WishlistState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(tenantId), JSON.stringify(ids));
    emit();
  } catch {
    /* ignore quota */
  }
}

export function toggleWishlist(tenantId: string, productId: string): boolean {
  const cur = loadWishlist(tenantId);
  const next = cur.includes(productId) ? cur.filter((x) => x !== productId) : [...cur, productId];
  saveWishlist(tenantId, next);
  return next.includes(productId);
}

export function isInWishlist(tenantId: string, productId: string): boolean {
  return loadWishlist(tenantId).includes(productId);
}

export function subscribeWishlist(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith("acos_wishlist_")) emit();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
