/**
 * Storefront cart context — shared between storefront layout and child routes.
 *
 * Persists per-tenant cart in localStorage via `src/lib/cart.ts`.
 * Tracks `add_to_cart`/quantity changes through the same `events` table that
 * the existing storefront has been writing to (keeps ACOS funnel intact).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadCart, saveCart, clearCart, type Cart } from "@/lib/cart";

export type CartProduct = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  stock: number;
};

type CartLine = {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  product: CartProduct;
};

type CartCtx = {
  tenantId: string;
  brand: string;
  slug: string;
  cart: Cart;
  cartCount: number;
  cartLines: CartLine[];
  totalCents: number;
  currency: string;
  addToCart: (p: CartProduct, qty?: number, variantId?: string | null) => void;
  updateQty: (productId: string, delta: number) => void;
  removeLine: (productId: string) => void;
  clear: () => void;
  registerProduct: (p: CartProduct) => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
};

const Ctx = createContext<CartCtx | null>(null);

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "acos_session_id";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export function track(
  tenantId: string,
  type:
    | "content_viewed"
    | "product_viewed"
    | "add_to_cart"
    | "checkout_started"
    | "purchase_completed",
  extra: { product_id?: string; order_id?: string; payload?: Record<string, unknown> } = {},
) {
  void supabase.from("events").insert({
    tenant_id: tenantId,
    type,
    session_id: getSessionId(),
    product_id: extra.product_id ?? null,
    order_id: extra.order_id ?? null,
    payload: { ts: new Date().toISOString(), ...(extra.payload ?? {}) },
  });
}

export function CartProvider({
  tenantId,
  brand,
  slug,
  initialProducts,
  children,
}: {
  tenantId: string;
  brand: string;
  slug: string;
  initialProducts: CartProduct[];
  children: ReactNode;
}) {
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [productCache, setProductCache] = useState<Record<string, CartProduct>>(() => {
    const map: Record<string, CartProduct> = {};
    for (const p of initialProducts) map[p.id] = p;
    return map;
  });

  // Hydrate from localStorage on mount / tenant change
  useEffect(() => {
    setCart(loadCart(tenantId));
  }, [tenantId]);

  // Persist to localStorage
  useEffect(() => {
    saveCart(tenantId, cart);
  }, [tenantId, cart]);

  // Keep cache in sync with new product data passed in
  useEffect(() => {
    setProductCache((prev) => {
      const next = { ...prev };
      for (const p of initialProducts) next[p.id] = p;
      return next;
    });
  }, [initialProducts]);

  const registerProduct = useCallback((p: CartProduct) => {
    setProductCache((prev) => ({ ...prev, [p.id]: p }));
  }, []);

  const addToCart = useCallback<CartCtx["addToCart"]>(
    (p, qty = 1, variantId = null) => {
      if (!Number.isFinite(qty) || qty < 1) return;
      registerProduct(p);
      setCart((prev) => {
        const current = prev[p.id]?.quantity ?? 0;
        if (p.stock <= 0 && current === 0) return prev; // truly OOS, nothing in cart yet
        const cap = p.stock > 0 ? p.stock : current; // if stock went to 0, don't increase
        const next = Math.max(1, Math.min(current + qty, cap));
        return { ...prev, [p.id]: { quantity: next } };
      });
      track(tenantId, "add_to_cart", {
        product_id: p.id,
        payload: { quantity: qty, price_cents: p.price_cents, variant_id: variantId },
      });
      toast.success(`Додано: ${p.name}`);
    },
    [tenantId, registerProduct],
  );

  const updateQty = useCallback<CartCtx["updateQty"]>((productId, delta) => {
    setCart((prev) => {
      const current = prev[productId]?.quantity ?? 0;
      const next = Math.max(0, current + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[productId];
      else copy[productId] = { quantity: next };
      return copy;
    });
  }, []);

  const removeLine = useCallback<CartCtx["removeLine"]>((productId) => {
    setCart((prev) => {
      const copy = { ...prev };
      delete copy[productId];
      return copy;
    });
  }, []);

  const clear = useCallback(() => {
    setCart({});
    clearCart(tenantId);
  }, [tenantId]);

  const cartLines = useMemo<CartLine[]>(() => {
    const lines: CartLine[] = [];
    for (const [productId, item] of Object.entries(cart)) {
      const product = productCache[productId];
      if (!product) continue;
      lines.push({
        product_id: productId,
        variant_id: null,
        quantity: item.quantity,
        product,
      });
    }
    return lines;
  }, [cart, productCache]);

  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);
  const totalCents = cartLines.reduce((s, l) => s + l.product.price_cents * l.quantity, 0);
  const currency = cartLines[0]?.product.currency ?? "UAH";

  const value = useMemo<CartCtx>(
    () => ({
      tenantId,
      brand,
      slug,
      cart,
      cartCount,
      cartLines,
      totalCents,
      currency,
      addToCart,
      updateQty,
      removeLine,
      clear,
      registerProduct,
      cartOpen,
      setCartOpen,
    }),
    [
      tenantId,
      brand,
      slug,
      cart,
      cartCount,
      cartLines,
      totalCents,
      currency,
      addToCart,
      updateQty,
      removeLine,
      clear,
      registerProduct,
      cartOpen,
      setCartOpen,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStorefrontCart(): CartCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useStorefrontCart must be used inside <CartProvider>");
  }
  return ctx;
}
