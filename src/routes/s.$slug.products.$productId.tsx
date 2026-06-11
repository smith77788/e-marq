/**
 * Product detail page — gallery, variant selector, add to cart, share.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Check,
  ShoppingCart,
  Share2,
  Package,
  Truck,
  RotateCcw,
  Shield,
  ZoomIn,
  Heart,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  loadProductDetail,
  type ProductDetail,
  type StorefrontVariant,
} from "@/lib/storefront/loaders";
import { useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { useWishlist } from "@/hooks/useWishlist";
import { formatMoneyExact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { RestockSubscribe } from "@/components/storefront/RestockSubscribe";
import { FrequentlyBoughtTogether } from "@/components/storefront/FrequentlyBoughtTogether";
import { canonicalUrl } from "@/lib/seo";
import { productJsonLd, breadcrumbJsonLd } from "@/lib/storefront/jsonLd";
import { tStatic } from "@/lib/i18n";
import { toast } from "sonner";

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
        { rel: "canonical", href: canonicalUrl(`/s/${params.slug}/products/${params.productId}`) },
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
      <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">Товар не знайдено.</p>
    </div>
  ),
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { slug, productId } = Route.useParams();
  const initial = Route.useLoaderData();
  const [descExpanded, setDescExpanded] = useState(false);

  const { data } = useQuery<ProductDetail>({
    queryKey: ["storefront-product", slug, productId],
    queryFn: () => loadProductDetail(slug, productId),
    initialData: initial,
    staleTime: 30_000,
  });

  const { product, variants, images } = data;
  const cart = useStorefrontCart();
  const wishlist = useWishlist(cart.tenantId);
  const liked = wishlist.has(product.id);

  // Gallery
  const galleryImages = useMemo(() => {
    if (images.length > 0) return images.map((i) => ({ url: i.url, alt: i.alt ?? product.name }));
    if (product.image_url) return [{ url: product.image_url, alt: product.name }];
    return [];
  }, [images, product.image_url, product.name]);
  const [activeImage, setActiveImage] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Variant selection
  const [selectedVariant, setSelectedVariant] = useState<StorefrontVariant | null>(() => {
    if (!product.has_variants || variants.length === 0) return null;
    return variants.find((v) => v.stock > 0) ?? variants[0];
  });

  // Option groups — supports multi-dimension variants
  const optionGroups = useMemo(() => {
    const groups: Record<string, StorefrontVariant[]> = {};
    for (const v of variants) {
      const key = v.option_1_name ?? "Варіант";
      if (!groups[key]) groups[key] = [];
      groups[key].push(v);
    }
    return groups;
  }, [variants]);

  // Active price/stock
  const activePriceCents = selectedVariant?.price_cents ?? product.price_cents;
  const activeCompareAt = selectedVariant?.compare_at_price_cents ?? product.compare_at_price_cents;
  const activeStock = selectedVariant?.stock ?? product.stock;
  const showDiscount = !!activeCompareAt && activeCompareAt > activePriceCents;
  const discountPct = showDiscount
    ? Math.round(((activeCompareAt! - activePriceCents) / activeCompareAt!) * 100)
    : 0;

  useEffect(() => {
    track(cart.tenantId, "product_viewed", { product_id: product.id });
  }, [cart.tenantId, product.id]);

  const inCart = cart.cart[product.id]?.quantity ?? 0;
  const outOfStock = activeStock <= 0;
  const [justAdded, setJustAdded] = useState(false);

  function addToCart() {
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
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: product.name, url });
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Посилання скопійовано!");
    }
  }

  const stockLabel =
    activeStock > 0 && activeStock <= 5
      ? `⚠ Залишилось ${activeStock} шт`
      : activeStock > 5
        ? "✓ В наявності"
        : null;

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-28 sm:pb-8">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <li>
              <Link
                to="/s/$slug"
                params={{ slug }}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" />
                {tStatic("sf.breadcrumb.shop")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-3 w-3" />
            </li>
            <li className="line-clamp-1 text-foreground font-medium" aria-current="page">
              {product.name}
            </li>
          </ol>
        </nav>

        <div className="grid gap-10 md:grid-cols-2">
          {/* ─── Gallery ─────────────────────────────────── */}
          <div className="space-y-3">
            <div className="group relative aspect-square w-full overflow-hidden rounded-2xl border bg-muted shadow-sm">
              {galleryImages.length > 0 ? (
                <>
                  <img
                    src={galleryImages[activeImage]?.url}
                    alt={galleryImages[activeImage]?.alt ?? product.name}
                    decoding="async"
                    fetchPriority="high"
                    width={800}
                    height={800}
                    className="h-full w-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-105"
                    onClick={() => setLightboxOpen(true)}
                  />
                  {/* Zoom hint */}
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                    aria-label="Збільшити фото"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Package className="h-24 w-24 text-muted-foreground/20" />
                </div>
              )}

              {/* Discount badge */}
              {showDiscount && (
                <div className="absolute left-3 top-3">
                  <Badge className="bg-destructive px-2 py-1 text-sm font-bold text-destructive-foreground">
                    -{discountPct}%
                  </Badge>
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {galleryImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {galleryImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    className={cn(
                      "h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                      i === activeImage
                        ? "border-primary shadow-md"
                        : "border-transparent opacity-60 hover:border-muted hover:opacity-100",
                    )}
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

          {/* ─── Product Info ────────────────────────────── */}
          <div className="space-y-5">
            {/* Title + actions */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-foreground sm:text-3xl">
                  {product.name}
                </h1>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => wishlist.toggle(product.id)}
                    aria-label={liked ? "Прибрати з обраного" : "Додати в обране"}
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
                      liked
                        ? "border-destructive/40 bg-destructive/5 text-destructive"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Heart className={cn("h-4 w-4", liked && "fill-current")} />
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    aria-label="Поділитися"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {product.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {product.tags.slice(0, 5).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[11px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold tabular-nums text-foreground">
                {formatMoneyExact(activePriceCents)}
              </span>
              {showDiscount && (
                <span className="text-lg text-muted-foreground line-through tabular-nums">
                  {formatMoneyExact(activeCompareAt!)}
                </span>
              )}
            </div>

            {/* Stock label */}
            {stockLabel && (
              <p
                className={cn(
                  "text-sm font-medium",
                  activeStock <= 5 ? "text-warning" : "text-success",
                )}
              >
                {stockLabel}
              </p>
            )}

            {/* Variants */}
            {Object.entries(optionGroups).map(([groupName, items]) => (
              <div key={groupName} className="space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  {groupName}
                  {selectedVariant && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      — {selectedVariant.option_1_value}
                    </span>
                  )}
                </p>
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
                        className={cn(
                          "relative rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground shadow-md"
                            : disabled
                              ? "border-muted bg-muted/50 text-muted-foreground"
                              : "border-input bg-background hover:border-primary/50 hover:bg-accent",
                        )}
                      >
                        {v.option_1_value ?? v.sku ?? "—"}
                        {disabled && (
                          <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/40" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <Separator />

            {/* Add to cart */}
            <div className="space-y-3">
              <Button
                size="lg"
                className={cn(
                  "w-full gap-2 text-base transition-all",
                  justAdded && "bg-success text-success-foreground hover:bg-success/90",
                )}
                disabled={outOfStock}
                onClick={addToCart}
              >
                {outOfStock ? (
                  "Немає в наявності"
                ) : justAdded ? (
                  <>
                    <Check className="h-5 w-5" />
                    Додано до кошика!
                  </>
                ) : inCart > 0 ? (
                  <>
                    <Check className="h-5 w-5" />У кошику ({inCart}) — додати ще
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-5 w-5" />
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

              {/* Trust microcopy */}
              <div className="grid grid-cols-3 gap-2">
                <MicroTrust icon={<Truck className="h-3.5 w-3.5" />} text="Нова Пошта" />
                <MicroTrust icon={<Shield className="h-3.5 w-3.5" />} text="Безпечна оплата" />
                <MicroTrust icon={<RotateCcw className="h-3.5 w-3.5" />} text="Повернення 14 днів" />
              </div>
            </div>

            {/* Description */}
            {product.description && (
              <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
                <p className="text-sm font-semibold text-foreground">Опис</p>
                <div
                  className={cn(
                    "overflow-hidden text-sm leading-relaxed text-muted-foreground transition-all",
                    !descExpanded && product.description.length > 300 && "max-h-24",
                  )}
                >
                  <p className="whitespace-pre-wrap">{product.description}</p>
                </div>
                {product.description.length > 300 && (
                  <button
                    type="button"
                    onClick={() => setDescExpanded((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {descExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" /> Згорнути
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" /> Читати далі
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Frequently bought together */}
        <FrequentlyBoughtTogether tenantId={cart.tenantId} productId={product.id} slug={slug} />
      </main>

      {/* ─── Sticky mobile buy bar ─────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur sm:hidden">
        <div className="flex items-center gap-3">
          <div>
            <p className="line-clamp-1 text-xs text-muted-foreground">{product.name}</p>
            <p className="text-base font-bold tabular-nums">{formatMoneyExact(activePriceCents)}</p>
          </div>
          <Button
            className={cn(
              "ml-auto gap-2 transition-all",
              justAdded && "bg-success text-success-foreground hover:bg-success/90",
            )}
            disabled={outOfStock}
            onClick={addToCart}
          >
            {outOfStock ? (
              "Немає"
            ) : justAdded ? (
              <>
                <Check className="h-4 w-4" />
                Додано!
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                Купити
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ─── Lightbox ──────────────────────────────────── */}
      {lightboxOpen && galleryImages.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Перегляд фото"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 text-white/70 hover:text-white"
            aria-label="Закрити"
            onClick={() => setLightboxOpen(false)}
          >
            ✕
          </button>
          <img
            src={galleryImages[activeImage]?.url}
            alt={galleryImages[activeImage]?.alt ?? product.name}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {galleryImages.length > 1 && (
            <div className="absolute bottom-6 flex gap-2">
              {galleryImages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveImage(i);
                  }}
                  className={cn(
                    "h-2 w-2 rounded-full transition-all",
                    i === activeImage ? "bg-white" : "bg-white/40",
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MicroTrust({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-background p-2 text-center">
      <span className="text-primary">{icon}</span>
      <span className="text-[10px] leading-tight text-muted-foreground">{text}</span>
    </div>
  );
}
