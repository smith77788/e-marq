/**
 * ProductCard — shared storefront product tile.
 * Used in index, search, collections, and wishlist pages.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Heart, Package, ShoppingCart, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { useWishlist } from "@/hooks/useWishlist";
import { formatMoneyExact } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { StorefrontProduct } from "@/lib/storefront/loaders";

export function ProductCard({ product, slug }: { product: StorefrontProduct; slug: string }) {
  const { tenantId } = useStorefrontCart();
  const cart = useStorefrontCart();
  const wishlist = useWishlist(tenantId);
  const inCart = cart.cart[product.id]?.quantity ?? 0;
  const liked = wishlist.has(product.id);
  const [viewed, setViewed] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

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

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    cart.addToCart({
      id: product.id,
      name: product.name,
      price_cents: product.price_cents,
      currency: product.currency,
      image_url: product.image_url,
      stock: product.stock,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2000);
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      {/* Image */}
      <Link
        to="/s/$slug/products/$productId"
        params={{ slug, productId: product.id }}
        className="relative block aspect-square w-full overflow-hidden bg-muted"
        aria-label={product.name}
        tabIndex={-1}
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            decoding="async"
            width={400}
            height={400}
            className={cn(
              "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
              outOfStock && "opacity-60 grayscale",
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <Package className="h-16 w-16 text-muted-foreground/25" />
          </div>
        )}

        {/* Badges overlay */}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {showDiscount && (
            <Badge className="bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">
              -{discountPct}%
            </Badge>
          )}
          {outOfStock && (
            <Badge variant="secondary" className="px-2 py-0.5 text-[11px]">
              Немає
            </Badge>
          )}
        </div>

        {/* Wishlist button */}
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
            "absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background/90 shadow-sm backdrop-blur transition-all",
            liked
              ? "border-destructive/40 text-destructive"
              : "border-border/60 text-muted-foreground opacity-0 group-hover:opacity-100",
          )}
        >
          <Heart className={cn("h-4 w-4", liked && "fill-current")} />
        </button>

        {/* OOS overlay */}
        {outOfStock && (
          <div className="absolute inset-0 flex items-end justify-center bg-background/30 pb-4 backdrop-blur-[1px]">
            <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-semibold text-muted-foreground shadow">
              Немає в наявності
            </span>
          </div>
        )}
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <Link
          to="/s/$slug/products/$productId"
          params={{ slug, productId: product.id }}
          className="line-clamp-2 text-sm font-semibold leading-snug text-foreground hover:text-primary"
        >
          {product.name}
        </Link>

        {/* Price */}
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tabular-nums text-foreground">
            {formatMoneyExact(product.price_cents)}
          </span>
          {showDiscount && (
            <span className="text-xs text-muted-foreground line-through tabular-nums">
              {formatMoneyExact(compareAt!)}
            </span>
          )}
        </div>

        {/* Action button */}
        <div className="mt-auto">
          {outOfStock ? (
            <Link
              to="/s/$slug/products/$productId"
              params={{ slug, productId: product.id }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              Деталі
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : product.has_variants ? (
            <Link
              to="/s/$slug/products/$productId"
              params={{ slug, productId: product.id }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              Обрати варіант
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Button
              size="sm"
              className={cn(
                "w-full gap-2 transition-all",
                justAdded && "bg-success text-success-foreground hover:bg-success/90",
              )}
              onClick={handleAddToCart}
            >
              {justAdded ? (
                <>
                  <Check className="h-4 w-4" />
                  Додано!
                </>
              ) : inCart > 0 ? (
                <>
                  <Check className="h-4 w-4" />У кошику ({inCart})
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4" />
                  Купити
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
