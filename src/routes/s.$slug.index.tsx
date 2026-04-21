/**
 * Storefront homepage: hero, optional collections strip, full product grid.
 * Loaded shell comes from the parent `s.$slug` layout — we re-use its data
 * via the same query key.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  loadStorefrontShell,
  loadCollections,
  type StorefrontProduct,
} from "@/lib/storefront/loaders";
import { useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { formatMoneyExact } from "@/lib/money";

export const Route = createFileRoute("/s/$slug/")({
  loader: async ({ params }) => {
    const [shell, collections] = await Promise.all([
      loadStorefrontShell(params.slug),
      loadCollections(params.slug).catch(() => []),
    ]);
    return { shell, collections };
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-6xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка: {error.message}</p>
    </div>
  ),
  component: StorefrontIndex,
});

function StorefrontIndex() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();

  const { data } = useQuery({
    queryKey: ["storefront-index", slug],
    queryFn: async () => {
      const [shell, collections] = await Promise.all([
        loadStorefrontShell(slug),
        loadCollections(slug).catch(() => []),
      ]);
      return { shell, collections };
    },
    initialData: initial,
    staleTime: 30_000,
  });

  const { shell, collections } = data;
  const ui = shell.config?.ui ?? {};

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {(ui.hero_image || ui.hero_headline) && (
        <section className="mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-accent/5">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-10">
            <div className="flex-1 space-y-3">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {ui.hero_headline ?? shell.config.brand_name}
              </h2>
              {ui.hero_subline && (
                <p className="text-sm text-muted-foreground sm:text-base">{ui.hero_subline}</p>
              )}
            </div>
            {ui.hero_image && (
              <img
                src={ui.hero_image}
                alt=""
                className="h-40 w-40 shrink-0 rounded-xl object-cover sm:h-48 sm:w-48"
              />
            )}
          </div>
        </section>
      )}

      {collections.length > 0 && (
        <section className="mb-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Категорії
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {collections.map((c) => (
              <Link
                key={c.id}
                to="/s/$slug/collections/$handle"
                params={{ slug, handle: c.handle }}
                className="group relative aspect-[3/2] overflow-hidden rounded-lg border bg-muted transition-shadow hover:shadow-md"
              >
                {c.image_url ? (
                  <img
                    src={c.image_url}
                    alt={c.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-primary/20 to-accent/10" />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <p className="text-sm font-semibold text-white">{c.name}</p>
                  <p className="text-xs text-white/80">{c.product_count} товарів</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">Усі товари</h2>
        <p className="text-sm text-muted-foreground">
          {shell.products.length} {pluralize(shell.products.length)} в наявності
        </p>
      </div>

      {shell.products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Поки що немає товарів.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shell.products.map((p) => (
            <ProductCard key={p.id} product={p} slug={slug} />
          ))}
        </div>
      )}
    </main>
  );
}

function pluralize(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return "товар";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "товари";
  return "товарів";
}

export function ProductCard({
  product,
  slug,
}: {
  product: StorefrontProduct;
  slug: string;
}) {
  const { tenantId } = useStorefrontCart();
  const cart = useStorefrontCart();
  const inCart = cart.cart[product.id]?.quantity ?? 0;
  const [viewed, setViewed] = useState(false);

  useEffect(() => {
    if (viewed) return;
    const t = setTimeout(() => {
      track(tenantId, "product_viewed", { product_id: product.id });
      setViewed(true);
    }, 300);
    return () => clearTimeout(t);
  }, [tenantId, product.id, viewed]);

  const outOfStock = product.stock <= 0;
  const compareAt = product.compare_at_price_cents;
  const showDiscount = !!compareAt && compareAt > product.price_cents;
  const discountPct = showDiscount
    ? Math.round(((compareAt! - product.price_cents) / compareAt!) * 100)
    : 0;

  return (
    <Card className="group flex flex-col overflow-hidden">
      <Link
        to="/s/$slug/products/$productId"
        params={{ slug, productId: product.id }}
        className="block"
        aria-label={product.name}
      >
        <div className="relative aspect-square w-full overflow-hidden bg-muted">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              Без фото
            </div>
          )}
          {showDiscount && (
            <Badge className="absolute left-2 top-2 bg-destructive text-destructive-foreground">
              -{discountPct}%
            </Badge>
          )}
          {outOfStock && (
            <Badge className="absolute right-2 top-2" variant="secondary">
              Немає
            </Badge>
          )}
        </div>
      </Link>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <Link
          to="/s/$slug/products/$productId"
          params={{ slug, productId: product.id }}
          className="line-clamp-2 text-sm font-medium text-foreground hover:underline"
        >
          {product.name}
        </Link>
        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-base font-semibold tabular-nums">
              {formatMoneyExact(product.price_cents)}
            </span>
            {showDiscount && (
              <span className="text-xs text-muted-foreground line-through tabular-nums">
                {formatMoneyExact(compareAt!)}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={outOfStock || product.has_variants}
          onClick={() =>
            cart.addToCart({
              id: product.id,
              name: product.name,
              price_cents: product.price_cents,
              currency: product.currency,
              image_url: product.image_url,
              stock: product.stock || 9999,
            })
          }
        >
          {outOfStock ? (
            "Немає в наявності"
          ) : product.has_variants ? (
            "Обрати варіант"
          ) : inCart > 0 ? (
            <>
              <Check className="mr-2 h-4 w-4" />У кошику ({inCart})
            </>
          ) : (
            <>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Додати в кошик
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
