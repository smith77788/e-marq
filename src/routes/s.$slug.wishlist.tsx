/**
 * Storefront wishlist page (`/s/$slug/wishlist`).
 *
 * Lists products that the visitor has saved on this device. The wishlist
 * itself lives in localStorage (per-tenant) — see `src/lib/storefront/wishlist.ts`
 * and the `useWishlist` hook. We re-use the cached storefront shell to render
 * full product cards with prices, stock and add-to-cart buttons.
 */
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { loadStorefrontShell, type StorefrontShell } from "@/lib/storefront/loaders";
import { useStorefrontCart } from "@/lib/storefront/cartContext";
import { useWishlist } from "@/hooks/useWishlist";
import { ProductCard } from "@/components/storefront/ProductCard";
import { useT, tStatic } from "@/lib/i18n";

export const Route = createFileRoute("/s/$slug/wishlist")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${tStatic("sf.wishlist.titleSuffix")} — ${loaderData?.config?.brand_name ?? tStatic("sf.shop.fallback")}`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">
        {tStatic("sf.wishlist.error")}: {error.message}
      </p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Магазин не знайдено.</p>
      <Link to="/" className="mt-3 inline-flex text-sm text-primary underline">
        На головну
      </Link>
    </div>
  ),
  component: WishlistPage,
});

function WishlistPage() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();
  const { tenantId } = useStorefrontCart();
  const wishlist = useWishlist(tenantId);
  const { t } = useT();

  const { data } = useQuery<StorefrontShell>({
    queryKey: ["storefront-shell", slug],
    queryFn: () => loadStorefrontShell(slug),
    initialData: initial,
    staleTime: 30_000,
  });

  const liked = useMemo(
    () => data.products.filter((p) => wishlist.ids.includes(p.id)),
    [data.products, wishlist.ids],
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("sf.wishlist.heading")}</h1>
          <p className="text-sm text-muted-foreground">
            {liked.length === 0
              ? t("sf.wishlist.empty")
              : `${liked.length} ${pluralize(liked.length)} ${t("sf.wishlist.countSuffix")}`}
          </p>
        </div>
        {liked.length > 0 && (
          <Button variant="ghost" size="sm" onClick={wishlist.clear}>
            {t("sf.wishlist.clear")}
          </Button>
        )}
      </div>

      {liked.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Heart className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">{t("sf.wishlist.hint")}</p>
            <Button asChild>
              <Link to="/s/$slug" params={{ slug }}>
                {t("sf.wishlist.toCatalog")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {liked.map((p) => (
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
