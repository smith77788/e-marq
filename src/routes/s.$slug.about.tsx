/**
 * Storefront "About" page (`/s/$slug/about`).
 *
 * Renders the owner-authored about text from tenant_configs.ui.about_text
 * (already returned by get_storefront_config). Plain text with preserved line
 * breaks — no HTML, so there is no stored-XSS surface from owner input.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { loadStorefrontShell } from "@/lib/storefront/loaders";
import { canonicalUrl } from "@/lib/seo";

export const Route = createFileRoute("/s/$slug/about")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: ({ loaderData, params }) => ({
    links: [{ rel: "canonical", href: canonicalUrl(`/s/${params.slug}/about`) }],
    meta: [{ title: `Про магазин — ${loaderData?.config?.brand_name ?? "Магазин"}` }],
  }),
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка: {error.message}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Магазин не знайдено.</p>
      <Link to="/" className="mt-3 inline-flex text-sm text-primary underline">
        На головну
      </Link>
    </div>
  ),
  component: AboutPage,
});

function AboutPage() {
  const { slug } = Route.useParams();
  const { config } = Route.useLoaderData();
  const ui = (config?.ui ?? {}) as Record<string, unknown>;
  const aboutText = typeof ui.about_text === "string" ? ui.about_text.trim() : "";
  const brand = config?.brand_name ?? "Магазин";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-foreground">Про {brand}</h1>
      {aboutText ? (
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground">
          {aboutText}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 py-20 text-center">
          <Info className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Інформація про магазин незабаром з'явиться тут.
          </p>
          <Link
            to="/s/$slug"
            params={{ slug }}
            className="mt-3 inline-flex text-sm text-primary underline"
          >
            До каталогу
          </Link>
        </div>
      )}
    </main>
  );
}
