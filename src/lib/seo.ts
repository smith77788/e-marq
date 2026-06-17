/**
 * SEO helper — produces canonical link + OG meta consistently across routes.
 *
 * Canonical origin uses SITE_URL env var if set, falling back to the
 * Lovable preview URL. In production, set SITE_URL to your custom domain.
 */
const CANONICAL_ORIGIN =
  (typeof process !== "undefined" && process.env?.SITE_URL) ||
  (typeof process !== "undefined" && process.env?.PUBLIC_APP_URL) ||
  "https://e-marq.lovable.app";

export function canonicalUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  // Strip trailing slash except for root.
  const normalized = clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
  return `${CANONICAL_ORIGIN}${normalized}`;
}

export type SeoMeta = {
  title: string;
  description: string;
  path: string;
  ogType?: string;
  /**
   * Absolute URL to a 1200×630 (preferred) image used for social previews.
   * Set per-route to give each shareable page its own card; omit when no
   * meaningful image exists (no image is better than a generic one).
   */
  ogImage?: string;
};

/**
 * Build the standard meta + link block for a public marketing route.
 * Pass directly into createFileRoute({ head: () => ({ ...buildSeo({...}) }) }).
 */
export function buildSeo({ title, description, path, ogType = "website", ogImage }: SeoMeta) {
  const url = canonicalUrl(path);
  const meta: Array<Record<string, string>> = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: ogType },
    { property: "og:url", content: url },
    {
      name: "twitter:card",
      content: ogImage ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (ogImage) {
    meta.push(
      { property: "og:image", content: ogImage },
      { name: "twitter:image", content: ogImage },
    );
  }
  return {
    meta,
    links: [{ rel: "canonical", href: url }],
  };
}

/**
 * Block search engines from indexing this route (login, signup, gated pages).
 * Compose with buildSeo's `meta` array if you also want title/description.
 */
export const NOINDEX_META = [
  { name: "robots", content: "noindex, nofollow" },
  { name: "googlebot", content: "noindex, nofollow" },
];
