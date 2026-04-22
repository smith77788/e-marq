/**
 * ProductCard — shared storefront product tile.
 *
 * Винесено зі `src/routes/s.$slug.index.tsx`, щоб route-файли НЕ експортували
 * компонентів — інакше TanStack auto-code-splitting кладе їх у головний бандл,
 * замість per-route chunk. Тепер index/search/collections/wishlist розділені.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Heart, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { useWishlist } from "@/hooks/useWishlist";
import { formatMoneyExact } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { StorefrontProduct } from "@/lib/storefront/loaders";

export function ProductCard({
  product,
  slug,
}: {
  product: StorefrontProduct;
  slug: string;
}) {
  const { tenantId } = useStorefrontCart();
  const cart = useStorefrontCart();
  const wishlist = useWishlist(tenantId);
  const inCart = cart.cart[product.id]?.quantity ?? 0;
  const liked = wishlist.has(product.id);
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
            <Badge className="absolute right-2 top-12" variant="secondary">
              Немає
            </Badge>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              wishlist.toggle(product.id);
            }}
            aria-label={liked ? "Прибрати з обраного" : "Додати в обране"}
            aria-pressed={liked}
            className={cn(
              "absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background/80 backdrop-blur transition-colors",
              liked
                ? "border-destructive/40 text-destructive"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Heart className={cn("h-4 w-4", liked && "fill-current")} />
          </button>
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
