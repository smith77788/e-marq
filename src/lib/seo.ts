/**
 * SEO helper — produces canonical link + OG meta consistently across routes.
 *
 * Canonical origin is hard-coded to the published URL because TanStack's
 * `head()` runs in both SSR and on the client and has no access to the
 * incoming Request — using window.location during SSR would crash, and a
 * relative href would resolve against preview URLs (id-preview--*.lovable.app)
 * causing duplicate-content signals.
 */
const CANONICAL_ORIGIN = "https://e-marq.lovable.app";

export function canonicalUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  // Strip trailing slash except for root.
  const normalized = clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
  return `${CANONICAL_ORIGIN}${normalized}`;
}

export type SeoMeta = { title: string; description: string; path: string; ogType?: string };

/**
 * Build the standard meta + link block for a public marketing route.
 * Pass directly into createFileRoute({ head: () => ({ ...buildSeo({...}) }) }).
 */
export function buildSeo({ title, description, path, ogType = "website" }: SeoMeta) {
  const url = canonicalUrl(path);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: ogType },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
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
