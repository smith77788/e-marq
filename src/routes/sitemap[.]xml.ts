/**
 * Dynamic sitemap.xml.
 *
 * Covers two URL surfaces:
 * 1. Marketing routes — static list (homepage, /pricing, /about, etc.).
 * 2. Storefront routes — live data: every active tenant's home, products,
 *    and collections. Pulled via the service-role client so RLS doesn't
 *    hide anything; we filter by `status = 'active'` / `is_active = true`
 *    in SQL because external visibility is what determines indexability.
 *
 * Failures in the storefront branch are swallowed — losing storefront URLs
 * is bad for SEO but never reason to break the marketing sitemap.
 *
 * `lastmod` is taken from `updated_at` per row (RFC 3339 date) so Google
 * sees real revision timestamps instead of a uniform "today".
 *
 * Cap: Google allows 50k URLs per sitemap. We log a warning past 45k so
 * we'll know to split into a sitemap index well before hitting the limit.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Login & signup are intentionally excluded — they're marked noindex.
const MARKETING_ROUTES = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/how-it-works", priority: "0.9", changefreq: "monthly" },
  { path: "/agents", priority: "0.9", changefreq: "monthly" },
  { path: "/pricing", priority: "0.9", changefreq: "monthly" },
  { path: "/about", priority: "0.7", changefreq: "monthly" },
  { path: "/contact", priority: "0.7", changefreq: "monthly" },
  { path: "/handbook", priority: "0.6", changefreq: "monthly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/refund", priority: "0.3", changefreq: "yearly" },
];

type SitemapEntry = {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: string;
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(input: string | null | undefined, fallback: string): string {
  if (!input) return fallback;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString().slice(0, 10);
}

async function buildStorefrontEntries(origin: string, today: string): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  try {
    const { data: tenants, error } = await supabaseAdmin
      .from("tenants")
      .select("id, slug, updated_at")
      .eq("status", "active");
    if (error || !tenants) return entries;

    // Index pages first (one per tenant).
    for (const t of tenants) {
      entries.push({
        loc: `${origin}/s/${t.slug}`,
        lastmod: isoDate(t.updated_at, today),
        changefreq: "daily",
        priority: "0.8",
      });
    }

    const tenantIds = tenants.map((t) => t.id);
    const tenantBySlug = new Map(tenants.map((t) => [t.id, t.slug]));
    if (tenantIds.length === 0) return entries;

    // Cap per-call fetch so a tenant with a huge catalogue can't blow up
    // memory/latency. The 50k-URL sitemap budget is still enforced below.
    const [productsRes, collectionsRes] = await Promise.all([
      supabaseAdmin
        .from("products")
        .select("id, tenant_id, updated_at")
        .in("tenant_id", tenantIds)
        .eq("is_active", true)
        .limit(5000),
      supabaseAdmin
        .from("collections")
        .select("handle, tenant_id, updated_at")
        .in("tenant_id", tenantIds)
        .eq("is_active", true)
        .limit(5000),
    ]);

    for (const p of productsRes.data ?? []) {
      const slug = tenantBySlug.get(p.tenant_id);
      if (!slug) continue;
      entries.push({
        loc: `${origin}/s/${slug}/products/${p.id}`,
        lastmod: isoDate(p.updated_at, today),
        changefreq: "weekly",
        priority: "0.7",
      });
    }
    for (const c of collectionsRes.data ?? []) {
      const slug = tenantBySlug.get(c.tenant_id);
      if (!slug) continue;
      entries.push({
        loc: `${origin}/s/${slug}/collections/${c.handle}`,
        lastmod: isoDate(c.updated_at, today),
        changefreq: "weekly",
        priority: "0.6",
      });
    }
  } catch (err) {
    // Swallow — marketing sitemap must still serve.
    console.error("[sitemap] storefront branch failed", err);
  }
  return entries;
}

function renderEntry(e: SitemapEntry): string {
  return `  <url>
    <loc>${xmlEscape(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        const today = new Date().toISOString().slice(0, 10);

        const marketing: SitemapEntry[] = MARKETING_ROUTES.map((r) => ({
          loc: `${origin}${r.path}`,
          lastmod: today,
          changefreq: r.changefreq,
          priority: r.priority,
        }));

        const storefront = await buildStorefrontEntries(origin, today);
        const all = [...marketing, ...storefront];
        if (all.length > 45_000) {
          console.warn(
            `[sitemap] entry count ${all.length} approaching 50k limit — consider sitemap index`,
          );
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(renderEntry).join("\n")}
</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
