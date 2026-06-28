/**
 * Smart SEO System — оптимізація для пошукових систем.
 *
 * Функції:
 * 1. Meta tags — мета-теги
 * 2. Open Graph — OG теги
 * 3. JSON-LD — структуровані дані
 * 4. Sitemap — карта сайту
 * 5. Robots.txt — правила для ботів
 */

export type SeoMeta = {
  title: string;
  description: string;
  keywords?: string[];
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
  twitterCard?: string;
  robots?: string;
};

/**
 * Генерувати meta теги.
 */
export function generateMetaTags(meta: SeoMeta): string {
  const tags: string[] = [];

  tags.push(`<title>${escapeHtml(meta.title)}</title>`);
  tags.push(`<meta name="description" content="${escapeHtml(meta.description)}">`);

  if (meta.keywords?.length) {
    tags.push(`<meta name="keywords" content="${meta.keywords.join(", ")}">`);
  }

  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${meta.canonical}">`);
  }

  if (meta.ogTitle) {
    tags.push(`<meta property="og:title" content="${escapeHtml(meta.ogTitle)}">`);
  }
  if (meta.ogDescription) {
    tags.push(`<meta property="og:description" content="${escapeHtml(meta.ogDescription)}">`);
  }
  if (meta.ogImage) {
    tags.push(`<meta property="og:image" content="${meta.ogImage}">`);
  }
  if (meta.ogType) {
    tags.push(`<meta property="og:type" content="${meta.ogType}">`);
  }

  if (meta.twitterCard) {
    tags.push(`<meta name="twitter:card" content="${meta.twitterCard}">`);
  }

  if (meta.robots) {
    tags.push(`<meta name="robots" content="${meta.robots}">`);
  }

  return tags.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
