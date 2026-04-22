/**
 * Storefront layout (`/s/$slug`) — header with brand + cart, theme vars,
 * shared cart context, and an Outlet for child routes (index, products,
 * collections, search, checkout).
 *
 * The previous monolithic `s.$slug.tsx` (homepage + cart sheet + checkout
 * dialog all in one) has been split: this layout owns the chrome and cart,
 * children own page bodies.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createFileRoute,
  Link,
  notFound,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Search, Loader2, Plus, Minus, Trash2, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { loadStorefrontShell, type StorefrontShell } from "@/lib/storefront/loaders";
import {
  CartProvider,
  useStorefrontCart,
  track,
} from "@/lib/storefront/cartContext";
import { useWishlist } from "@/hooks/useWishlist";
import { formatMoneyExact } from "@/lib/money";

export const Route = createFileRoute("/s/$slug")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: ({ loaderData }) => {
    const brand = loaderData?.config?.brand_name ?? loaderData?.tenant.name ?? "Store";
    const seo = loaderData?.config?.seo ?? {};
    const title = seo.title ?? `${brand} — Магазин`;
    const description = seo.description ?? `Замовити в магазині ${brand}.`;
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
        <h1 className="text-3xl font-bold text-foreground">Магазин не знайдено</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Цей магазин не існує або був вимкнений.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          На головну
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-destructive">Не вдалося завантажити магазин: {error.message}</p>
    </div>
  ),
  component: StorefrontLayout,
});

function StorefrontLayout() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();

  const { data } = useQuery<StorefrontShell>({
    queryKey: ["storefront-shell", slug],
    queryFn: () => loadStorefrontShell(slug),
    initialData: initial,
    staleTime: 30_000,
  });

  if (!data) throw notFound();

  const tenant = data.tenant;
  const config = data.config;
  const brand = config?.brand_name ?? tenant.name;

  const ui = config?.ui ?? {};
  const themeStyle = useMemo(() => {
    const style: Record<string, string> = {};
    if (ui.primary) style["--primary"] = ui.primary;
    if (ui.accent) style["--accent"] = ui.accent;
    return style as React.CSSProperties;
  }, [ui.primary, ui.accent]);

  const cartProducts = useMemo(
    () =>
      data.products.map((p) => ({
        id: p.id,
        name: p.name,
        price_cents: p.price_cents,
        currency: p.currency,
        image_url: p.image_url,
        stock: p.stock,
      })),
    [data.products],
  );

  // Mark a single page-view event per route mount
  useEffect(() => {
    track(tenant.id, "content_viewed", { payload: { path: `/s/${slug}` } });
  }, [tenant.id, slug]);

  return (
    <div className="min-h-screen bg-background" style={themeStyle}>
      <CartProvider tenantId={tenant.id} brand={brand} slug={slug} initialProducts={cartProducts}>
        <StorefrontHeader brand={brand} slug={slug} products={data.products} />
        <Outlet />
        <footer className="border-t py-6">
          <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground">
            Powered by MARQ · /{tenant.slug}
          </div>
        </footer>
        <CartSheet />
      </CartProvider>
    </div>
  );
}

type SearchSuggestion = {
  id: string;
  name: string;
  image_url: string | null;
  price_cents: number;
};

function StorefrontHeader({
  brand,
  slug,
  products,
}: {
  brand: string;
  slug: string;
  products: StorefrontShell["products"];
}) {
  const { cartCount, setCartOpen, tenantId } = useStorefrontCart();
  const wishlist = useWishlist(tenantId);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close suggestions on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const suggestions = useMemo<SearchSuggestion[]>(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const out: SearchSuggestion[] = [];
    for (const p of products) {
      const haystack = [p.name, p.description ?? "", ...(p.tags ?? [])]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(query)) {
        out.push({
          id: p.id,
          name: p.name,
          image_url: p.image_url,
          price_cents: p.price_cents,
        });
        if (out.length >= 6) break;
      }
    }
    return out;
  }, [q, products]);

  const submit = () => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setOpen(false);
    navigate({ to: "/s/$slug/search", params: { slug }, search: { q: trimmed } });
  };

  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link
          to="/s/$slug"
          params={{ slug }}
          className="text-lg font-bold tracking-tight text-foreground"
        >
          {brand}
        </Link>
        <div ref={wrapperRef} className="relative ml-auto flex flex-1 items-center sm:max-w-sm">
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Пошук товарів…"
                className="h-9 pl-8 text-sm"
                aria-label="Пошук товарів"
                aria-autocomplete="list"
                aria-expanded={open && suggestions.length > 0}
              />
            </div>
          </form>
          {open && suggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute left-0 right-0 top-11 z-20 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
            >
              {suggestions.map((s) => (
                <button
                  type="button"
                  role="option"
                  key={s.id}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    navigate({
                      to: "/s/$slug/products/$productId",
                      params: { slug, productId: s.id },
                    });
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {s.image_url ? (
                    <img src={s.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted" />
                  )}
                  <span className="line-clamp-1 flex-1">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatMoneyExact(s.price_cents)}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={submit}
                className="block w-full border-t border-border px-3 py-2 text-left text-xs font-medium text-primary hover:bg-accent"
              >
                Показати всі результати →
              </button>
            </div>
          )}
        </div>
        <Link
          to="/s/$slug/wishlist"
          params={{ slug }}
          aria-label={`Обране (${wishlist.count})`}
          className="relative inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-sm hover:bg-accent"
        >
          <Heart className={wishlist.count > 0 ? "h-4 w-4 fill-destructive text-destructive" : "h-4 w-4"} />
          {wishlist.count > 0 && (
            <span className="tabular-nums">{wishlist.count}</span>
          )}
        </Link>
        <Button
          size="sm"
          variant="outline"
          className="relative shrink-0"
          onClick={() => setCartOpen(true)}
          aria-label={`Кошик (${cartCount})`}
        >
          <ShoppingCart className="h-4 w-4" />
          <span className="ml-2 tabular-nums">{cartCount}</span>
        </Button>
      </div>
    </header>
  );
}

function CartSheet() {
  const {
    cartLines,
    totalCents,
    currency,
    cartOpen,
    setCartOpen,
    updateQty,
    removeLine,
    slug,
    tenantId,
  } = useStorefrontCart();
  const navigate = useNavigate();

  return (
    <Sheet open={cartOpen} onOpenChange={setCartOpen}>
      <SheetTrigger className="hidden" />
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Ваш кошик</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-4">
          {cartLines.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Кошик порожній</p>
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
                        aria-label="Видалити"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatMoneyExact(product.price_cents)}
                    </span>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => updateQty(product.id, -1)}
                        aria-label="Зменшити"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => updateQty(product.id, 1)}
                        aria-label="Збільшити"
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
              <span>Разом</span>
              <span className="tabular-nums">{formatMoneyExact(totalCents)}</span>
            </div>
            <Button
              className="w-full"
              disabled={cartLines.length === 0}
              onClick={() => {
                if (cartLines.length === 0) return;
                track(tenantId, "checkout_started", {
                  payload: { total_cents: totalCents, items: cartLines.length, currency },
                });
                setCartOpen(false);
                navigate({ to: "/s/$slug/checkout", params: { slug } });
              }}
            >
              {cartLines.length === 0 ? (
                "Кошик порожній"
              ) : (
                <>
                  <Loader2 className="mr-2 hidden h-4 w-4 animate-spin" />
                  Оформити замовлення
                </>
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
