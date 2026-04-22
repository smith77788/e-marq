/**
 * JSON-LD (Schema.org) builders for storefront SEO.
 *
 * We emit structured data via `head().scripts` so TanStack injects it during SSR
 * — Google reads JSON-LD before hydration, so client-only injection would miss
 * the first crawl pass.
 *
 * Currency: defaults to UAH (project is Ukraine-first); uppercase ISO 4217.
 * Availability: Schema.org URLs (https://schema.org/InStock, /OutOfStock).
 */
import { canonicalUrl } from "@/lib/seo";
import type { CollectionDetail, ProductDetail, StorefrontShell } from "@/lib/storefront/loaders";

const SCHEMA = "https://schema.org";

function availability(stock: number) {
  return stock > 0 ? `${SCHEMA}/InStock` : `${SCHEMA}/OutOfStock`;
}

function priceString(cents: number) {
  return (cents / 100).toFixed(2);
}

function currencyOf(currency: string | undefined) {
  return (currency ?? "UAH").toUpperCase();
}

/**
 * Product page — full Product schema with offers.
 * If product has variants, emits an array of Offer entries; otherwise a single Offer.
 */
export function productJsonLd(detail: ProductDetail, slug: string) {
  const { product, variants, images } = detail;
  const url = canonicalUrl(`/s/${slug}/products/${product.id}`);
  const imageUrls = images.length
    ? images.map((i) => i.url)
    : product.image_url
      ? [product.image_url]
      : [];

  const baseOffer = {
    "@type": "Offer",
    url,
    priceCurrency: currencyOf(product.currency),
    price: priceString(product.price_cents),
    availability: availability(product.stock),
    itemCondition: `${SCHEMA}/NewCondition`,
  };

  const offers =
    product.has_variants && variants.length > 0
      ? {
          "@type": "AggregateOffer",
          priceCurrency: currencyOf(product.currency),
          lowPrice: priceString(Math.min(...variants.map((v) => v.price_cents))),
          highPrice: priceString(Math.max(...variants.map((v) => v.price_cents))),
          offerCount: variants.length,
          availability: availability(variants.reduce((s, v) => s + v.stock, 0)),
        }
      : baseOffer;

  return {
    "@context": SCHEMA,
    "@type": "Product",
    name: product.name,
    description: product.description ?? product.seo_description ?? product.name,
    sku: product.id,
    ...(imageUrls.length > 0 && { image: imageUrls }),
    url,
    offers,
  };
}

/**
 * Collection page — ItemList of products with positions.
 * Limited to first 30 items to keep the JSON payload reasonable.
 */
export function collectionJsonLd(detail: CollectionDetail, slug: string) {
  const items = detail.products.slice(0, 30).map((p) => ({
    "@type": "ListItem",
    position: p.position,
    url: canonicalUrl(`/s/${slug}/products/${p.id}`),
    name: p.name,
  }));
  return {
    "@context": SCHEMA,
    "@type": "ItemList",
    name: detail.collection.name,
    ...(detail.collection.description && { description: detail.collection.description }),
    numberOfItems: detail.products.length,
    itemListElement: items,
  };
}

/**
 * Storefront homepage — emits both Organization and WebSite entries.
 * Returns an array; caller is responsible for stringifying each separately.
 */
export function storefrontIndexJsonLd(shell: StorefrontShell, slug: string) {
  const url = canonicalUrl(`/s/${slug}`);
  const brandName = shell.config.brand_name;
  return [
    {
      "@context": SCHEMA,
      "@type": "Organization",
      name: brandName,
      url,
    },
    {
      "@context": SCHEMA,
      "@type": "WebSite",
      name: brandName,
      url,
      potentialAction: {
        "@type": "SearchAction",
        target: `${url}/search?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

/**
 * BreadcrumbList — caller passes ordered crumbs ({ name, path }).
 * `path` is the storefront-relative URL (e.g. `/s/acme/collections/hats`);
 * we resolve it through `canonicalUrl()` so absolute URLs end up in the JSON.
 */
export function breadcrumbJsonLd(crumbs: Array<{ name: string; path: string }>) {
  return {
    "@context": SCHEMA,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: canonicalUrl(c.path),
    })),
  };
}
