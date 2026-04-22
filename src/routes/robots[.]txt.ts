/**
 * Dynamic robots.txt — points crawlers at the live sitemap.
 * Disallows authenticated app routes from being indexed.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        const body = `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /brand\nDisallow: /admin\nDisallow: /onboarding\nDisallow: /profile\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
