/**
 * Product detail page — gallery, variant selector, add to cart, breadcrumbs.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Check, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  loadProductDetail,
  type ProductDetail,
  type StorefrontVariant,
} from "@/lib/storefront/loaders";
import { useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { formatMoneyExact } from "@/lib/money";
import { RestockSubscribe } from "@/components/storefront/RestockSubscribe";
import { canonicalUrl } from "@/lib/seo";
import { productJsonLd, breadcrumbJsonLd } from "@/lib/storefront/jsonLd";
import { tStatic } from "@/lib/i18n";

export const Route = createFileRoute("/s/$slug/products/$productId")({
  loader: ({ params }) => loadProductDetail(params.slug, params.productId),
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [] };
    const p = loaderData.product;
    const title = p.seo_title ?? `${p.name} — Купити онлайн`;
    const description = p.seo_description ?? p.description ?? `Замовити ${p.name}.`;
    const image = loaderData.images[0]?.url ?? p.image_url ?? undefined;
    return {
      meta: [
        { title },
        { name: "description", content: description.slice(0, 160) },
        { property: "og:title", content: title },
        { property: "og:description", content: description.slice(0, 160) },
        ...(image ? [{ property: "og:image", content: image }] : []),
      ],
      links: [
        {
          rel: "canonical",
          href: canonicalUrl(`/s/${params.slug}/products/${params.productId}`),
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(productJsonLd(loaderData, params.slug)),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbJsonLd([
              { name: tStatic("sf.breadcrumb.shop"), path: `/s/${params.slug}` },
              { name: p.name, path: `/s/${params.slug}/products/${params.productId}` },
            ]),
          ),
        },
      ],
    };
  },
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Не вдалося завантажити товар: {error.message}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Товар не знайдено.</p>
    </div>
  ),
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { slug, productId } = Route.useParams();
  const initial = Route.useLoaderData();

  const { data } = useQuery<ProductDetail>({
    queryKey: ["storefront-product", slug, productId],
    queryFn: () => loadProductDetail(slug, productId),
    initialData: initial,
    staleTime: 30_000,
  });

  const { product, variants, images } = data;
  const cart = useStorefrontCart();

  // Image gallery
  const galleryImages = useMemo(() => {
    if (images.length > 0) return images.map((i) => ({ url: i.url, alt: i.alt ?? product.name }));
    if (product.image_url) return [{ url: product.image_url, alt: product.name }];
    return [];
  }, [images, product.image_url, product.name]);
  const [activeImage, setActiveImage] = useState(0);

  // Variant selection — pick first in-stock by default if has_variants
  const [selectedVariant, setSelectedVariant] = useState<StorefrontVariant | null>(() => {
    if (!product.has_variants || variants.length === 0) return null;
    return variants.find((v) => v.stock > 0) ?? variants[0];
  });

  // Group variants by option_1_name for selector pills
  const optionGroups = useMemo(() => {
    const groups: Record<string, StorefrontVariant[]> = {};
    for (const v of variants) {
      const key = v.option_1_name ?? "Варіант";
      if (!groups[key]) groups[key] = [];
      groups[key].push(v);
    }
    return groups;
  }, [variants]);

  // Active price/stock — variant overrides product
  const activePriceCents = selectedVariant?.price_cents ?? product.price_cents;
  const activeCompareAt = selectedVariant?.compare_at_price_cents ?? product.compare_at_price_cents;
  const activeStock = selectedVariant?.stock ?? product.stock;
  const showDiscount = !!activeCompareAt && activeCompareAt > activePriceCents;
  const discountPct = showDiscount
    ? Math.round(((activeCompareAt! - activePriceCents) / activeCompareAt!) * 100)
    : 0;

  // Track product view
  useEffect(() => {
    track(cart.tenantId, "product_viewed", { product_id: product.id });
  }, [cart.tenantId, product.id]);

  const inCart = cart.cart[product.id]?.quantity ?? 0;
  const outOfStock = activeStock <= 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-1 text-xs text-muted-foreground">
          <li className="inline-flex items-center">
            <Link
              to="/s/$slug"
              params={{ slug }}
              className="inline-flex items-center hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden="true" />
              {tStatic("sf.breadcrumb.shop")}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="line-clamp-1 text-foreground" aria-current="page">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Gallery */}
        <div className="space-y-3">
          <div className="aspect-square w-full overflow-hidden rounded-xl border bg-muted">
            {galleryImages.length > 0 ? (
              <img
                src={galleryImages[activeImage]?.url}
                alt={galleryImages[activeImage]?.alt ?? product.name}
                decoding="async"
                fetchPriority="high"
                width={800}
                height={800}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                Без фото
              </div>
            )}
          </div>
          {galleryImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {galleryImages.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveImage(i)}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                    i === activeImage ? "border-primary" : "border-transparent hover:border-muted"
                  }`}
                  aria-label={`Фото ${i + 1}`}
                >
                  <img
                    src={img.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {product.name}
            </h1>
            {product.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {product.tags.slice(0, 5).map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {formatMoneyExact(activePriceCents)}
            </span>
            {showDiscount && (
              <>
                <span className="text-lg text-muted-foreground line-through tabular-nums">
                  {formatMoneyExact(activeCompareAt!)}
                </span>
                <Badge className="bg-destructive text-destructive-foreground">
                  ЗНИЖКА -{discountPct}%
                </Badge>
              </>
            )}
          </div>

          {/* Variants */}
          {Object.entries(optionGroups).map(([groupName, items]) => (
            <div key={groupName} className="space-y-2">
              <p className="text-sm font-medium text-foreground">{groupName}</p>
              <div className="flex flex-wrap gap-2">
                {items.map((v) => {
                  const isSelected = selectedVariant?.id === v.id;
                  const disabled = v.stock <= 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedVariant(v)}
                      className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : disabled
                            ? "border-muted bg-muted/50 text-muted-foreground line-through"
                            : "border-input bg-background hover:bg-accent"
                      }`}
                    >
                      {v.option_1_value ?? v.sku ?? "—"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <Separator />

          <Button
            size="lg"
            className="w-full"
            disabled={outOfStock}
            onClick={() => {
              cart.addToCart(
                {
                  id: product.id,
                  name: product.name,
                  price_cents: activePriceCents,
                  currency: product.currency,
                  image_url: galleryImages[0]?.url ?? null,
                  stock: activeStock || 9999,
                },
                1,
                selectedVariant?.id ?? null,
              );
            }}
          >
            {outOfStock ? (
              "Немає в наявності"
            ) : inCart > 0 ? (
              <>
                <Check className="mr-2 h-4 w-4" />У кошику ({inCart}) — додати ще
              </>
            ) : (
              <>
                <ShoppingCart className="mr-2 h-4 w-4" />
                Додати в кошик
              </>
            )}
          </Button>

          {outOfStock && (
            <RestockSubscribe
              tenantId={cart.tenantId}
              productId={product.id}
              variantId={selectedVariant?.id ?? null}
            />
          )}

          {product.description && (
            <Card>
              <CardContent className="prose prose-sm max-w-none whitespace-pre-wrap py-4 text-sm text-foreground">
                {product.description}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
