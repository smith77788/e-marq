import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShoppingCart,
  Check,
  Plus,
  Minus,
  Trash2,
  Loader2,
  Landmark,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { loadCart, saveCart, clearCart, type Cart } from "@/lib/cart";

type TenantRow = { id: string; name: string; slug: string; status: string };
type ConfigRow = {
  brand_name: string;
  ui: Record<string, unknown> | null;
  seo: Record<string, unknown> | null;
};
type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  stock: number;
};

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

function track(
  tenantId: string,
  type: "content_viewed" | "product_viewed" | "add_to_cart" | "checkout_started" | "purchase_completed",
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

async function loadStorefront(slug: string) {
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, slug, status")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw notFound();

  const [{ data: config, error: cErr }, { data: products, error: pErr }] = await Promise.all([
    supabase
      .from("tenant_configs")
      .select("brand_name, ui, seo")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id, name, description, price_cents, currency, image_url, stock")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;

  return {
    tenant: tenant as TenantRow,
    config: (config ?? null) as ConfigRow | null,
    products: (products ?? []) as Product[],
  };
}

export const Route = createFileRoute("/s/$slug")({
  loader: ({ params }) => loadStorefront(params.slug),
  head: ({ loaderData }) => {
    const brand = loaderData?.config?.brand_name ?? loaderData?.tenant.name ?? "Store";
    const seo = (loaderData?.config?.seo ?? {}) as {
      title?: string;
      description?: string;
      og_image?: string;
    };
    const title = seo.title ?? `${brand} — Shop`;
    const description = seo.description ?? `Shop products from ${brand}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(seo.og_image ? [{ property: "og:image", content: seo.og_image }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-foreground">Store not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This storefront does not exist or has been disabled.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go home
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-destructive">Failed to load store: {error.message}</p>
    </div>
  ),
  component: StorefrontPage,
});

function StorefrontPage() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();

  const { data } = useQuery<Awaited<ReturnType<typeof loadStorefront>>>({
    queryKey: ["storefront", slug],
    queryFn: () => loadStorefront(slug),
    initialData: initial,
    staleTime: 30_000,
  });

  const tenant = data.tenant;
  const config = data.config;
  const products = data.products;
  const brand = config?.brand_name ?? tenant.name;

  const ui = (config?.ui ?? {}) as { primary?: string; accent?: string };
  const themeStyle = useMemo(() => {
    const style: Record<string, string> = {};
    if (ui.primary) style["--primary"] = ui.primary;
    if (ui.accent) style["--accent"] = ui.accent;
    return style as React.CSSProperties;
  }, [ui.primary, ui.accent]);

  // Cart state synced with localStorage per tenant
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    setCart(loadCart(tenant.id));
  }, [tenant.id]);

  useEffect(() => {
    saveCart(tenant.id, cart);
  }, [tenant.id, cart]);

  const cartCount = Object.values(cart).reduce((s, n) => s + n.quantity, 0);
  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .map(([productId, item]) => {
        const product = productById.get(productId);
        if (!product) return null;
        return { product, quantity: item.quantity };
      })
      .filter((x): x is { product: Product; quantity: number } => x !== null);
  }, [cart, productById]);

  const totalCents = cartLines.reduce((s, l) => s + l.product.price_cents * l.quantity, 0);
  const currency = cartLines[0]?.product.currency ?? "USD";

  useEffect(() => {
    track(tenant.id, "content_viewed", { payload: { path: `/s/${slug}` } });
  }, [tenant.id, slug]);

  function addToCart(p: Product) {
    setCart((prev) => {
      const current = prev[p.id]?.quantity ?? 0;
      const next = Math.min(current + 1, p.stock);
      return { ...prev, [p.id]: { quantity: next } };
    });
    track(tenant.id, "add_to_cart", {
      product_id: p.id,
      payload: { quantity: 1, price_cents: p.price_cents },
    });
    toast.success(`Added ${p.name}`);
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) => {
      const product = productById.get(productId);
      const current = prev[productId]?.quantity ?? 0;
      const max = product?.stock ?? current;
      const next = Math.max(0, Math.min(current + delta, max));
      const copy = { ...prev };
      if (next === 0) delete copy[productId];
      else copy[productId] = { quantity: next };
      return copy;
    });
  }

  function removeLine(productId: string) {
    setCart((prev) => {
      const copy = { ...prev };
      delete copy[productId];
      return copy;
    });
  }

  function openCheckout() {
    if (cartLines.length === 0) return;
    track(tenant.id, "checkout_started", {
      payload: { total_cents: totalCents, items: cartLines.length },
    });
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  return (
    <div className="min-h-screen bg-background" style={themeStyle}>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-foreground">{brand}</h1>
          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="relative">
                <ShoppingCart className="h-4 w-4" />
                <span className="ml-2">{cartCount}</span>
              </Button>
            </SheetTrigger>
            <SheetContent className="flex w-full flex-col sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Your cart</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto py-4">
                {cartLines.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground">Cart is empty</p>
                ) : (
                  <ul className="space-y-3">
                    {cartLines.map(({ product, quantity }) => (
                      <li key={product.id} className="flex gap-3 rounded-md border p-3">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="h-16 w-16 rounded object-cover"
                          />
                        ) : (
                          <div className="h-16 w-16 rounded bg-muted" />
                        )}
                        <div className="flex flex-1 flex-col">
                          <div className="flex justify-between gap-2">
                            <span className="line-clamp-1 text-sm font-medium">{product.name}</span>
                            <button
                              type="button"
                              onClick={() => removeLine(product.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {(product.price_cents / 100).toFixed(2)} {product.currency}
                          </span>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => updateQty(product.id, -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm">{quantity}</span>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => updateQty(product.id, 1)}
                              disabled={quantity >= product.stock}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <SheetFooter className="border-t pt-4">
                <div className="w-full space-y-3">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Total</span>
                    <span>
                      {(totalCents / 100).toFixed(2)} {currency}
                    </span>
                  </div>
                  <Button
                    className="w-full"
                    disabled={cartLines.length === 0}
                    onClick={openCheckout}
                  >
                    Checkout
                  </Button>
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">Shop</h2>
          <p className="text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? "product" : "products"} available
          </p>
        </div>

        {products.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No products available yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                tenantId={tenant.id}
                inCart={cart[p.id]?.quantity ?? 0}
                onAdd={() => addToCart(p)}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground">
          Powered by ACOS · /{tenant.slug}
        </div>
      </footer>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        tenantId={tenant.id}
        cartLines={cartLines}
        totalCents={totalCents}
        currency={currency}
        onSuccess={() => {
          setCart({});
          clearCart(tenant.id);
        }}
      />
    </div>
  );
}

function ProductCard({
  product,
  tenantId,
  inCart,
  onAdd,
}: {
  product: Product;
  tenantId: string;
  inCart: number;
  onAdd: () => void;
}) {
  const [viewed, setViewed] = useState(false);

  useEffect(() => {
    if (viewed) return;
    const t = setTimeout(() => {
      track(tenantId, "product_viewed", { product_id: product.id });
      setViewed(true);
    }, 300);
    return () => clearTimeout(t);
  }, [tenantId, product.id, viewed]);

  const price = (product.price_cents / 100).toFixed(2);
  const outOfStock = product.stock <= 0;
  const maxedOut = inCart >= product.stock;

  return (
    <Card className="overflow-hidden">
      {product.image_url ? (
        <div className="aspect-square w-full overflow-hidden bg-muted">
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted">
          <span className="text-xs text-muted-foreground">No image</span>
        </div>
      )}
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-medium text-foreground">{product.name}</h3>
          <Badge variant="outline" className="shrink-0">
            {price} {product.currency}
          </Badge>
        </div>
        {product.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{product.description}</p>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={outOfStock || maxedOut}
          onClick={onAdd}
        >
          {outOfStock ? (
            "Out of stock"
          ) : inCart > 0 ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              In cart ({inCart})
            </>
          ) : (
            <>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Add to cart
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function CheckoutDialog({
  open,
  onOpenChange,
  tenantId,
  cartLines,
  totalCents,
  currency,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  cartLines: { product: Product; quantity: number }[];
  totalCents: number;
  currency: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ orderId: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setDone(null);
      setSubmitting(false);
    }
  }, [open]);

  async function placeOrder() {
    if (!email.trim() || cartLines.length === 0) return;
    setSubmitting(true);
    try {
      const { data: order, error: oErr } = await supabase
        .from("orders")
        .insert({
          tenant_id: tenantId,
          customer_email: email.trim(),
          customer_name: name.trim() || null,
          currency,
          total_cents: totalCents,
          status: "paid", // mock — Stripe integration буде наступним кроком
          metadata: { source: "storefront", session_id: getSessionId() },
        })
        .select("id")
        .single();
      if (oErr) throw oErr;

      const items = cartLines.map((l) => ({
        order_id: order.id,
        tenant_id: tenantId,
        product_id: l.product.id,
        product_name: l.product.name,
        quantity: l.quantity,
        unit_price_cents: l.product.price_cents,
      }));
      const { error: iErr } = await supabase.from("order_items").insert(items);
      if (iErr) throw iErr;

      track(tenantId, "purchase_completed", {
        order_id: order.id,
        payload: { total_cents: totalCents, items: items.length, currency },
      });

      setDone({ orderId: order.id });
      onSuccess();
      toast.success("Order placed!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to place order";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Order confirmed" : "Checkout"}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-4 py-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Thank you for your order.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Order #{done.orderId.slice(0, 8)}
              </p>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Continue shopping
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div className="rounded-md border p-3">
                <ul className="space-y-1 text-xs">
                  {cartLines.map((l) => (
                    <li key={l.product.id} className="flex justify-between">
                      <span className="line-clamp-1">
                        {l.product.name} × {l.quantity}
                      </span>
                      <span>
                        {((l.product.price_cents * l.quantity) / 100).toFixed(2)} {currency}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t pt-2 text-sm font-medium">
                  <span>Total</span>
                  <span>
                    {(totalCents / 100).toFixed(2)} {currency}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-name">Name (optional)</Label>
                <Input
                  id="checkout-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-email">Email *</Label>
                <Input
                  id="checkout-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={submitting}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Demo checkout — payment will be added in next step.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={placeOrder} disabled={submitting || !email.trim()}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Place order
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
