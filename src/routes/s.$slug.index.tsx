/**
 * Storefront homepage: hero, optional collections strip, full product grid.
 * Loaded shell comes from the parent `s.$slug` layout — we re-use its data
 * via the same query key.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import {
  loadStorefrontShell,
  loadCollections,
  type CollectionSummary,
  type StorefrontShell,
} from "@/lib/storefront/loaders";
import { ProductCard } from "@/components/storefront/ProductCard";
import { canonicalUrl } from "@/lib/seo";
import { storefrontIndexJsonLd } from "@/lib/storefront/jsonLd";

export const Route = createFileRoute("/s/$slug/")({
  loader: async ({ params }) => {
    const [shell, collections] = await Promise.all([
      loadStorefrontShell(params.slug),
      loadCollections(params.slug).catch(() => []),
    ]);
    return { shell, collections };
  },
  head: ({ loaderData, params }) => ({
    links: [{ rel: "canonical", href: canonicalUrl(`/s/${params.slug}`) }],
    meta: [{ property: "og:url", content: canonicalUrl(`/s/${params.slug}`) }],
    scripts: loaderData
      ? storefrontIndexJsonLd(loaderData.shell, params.slug).map((entry) => ({
          type: "application/ld+json",
          children: JSON.stringify(entry),
        }))
      : [],
  }),
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-6xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка: {error.message}</p>
    </div>
  ),
  component: StorefrontIndex,
});

function StorefrontIndex() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();

  const { data } = useQuery<{ shell: StorefrontShell; collections: CollectionSummary[] }>({
    queryKey: ["storefront-index", slug],
    queryFn: async () => {
      const [shell, collections] = await Promise.all([
        loadStorefrontShell(slug),
        loadCollections(slug).catch(() => [] as CollectionSummary[]),
      ]);
      return { shell, collections };
    },
    initialData: initial,
    staleTime: 30_000,
  });

  const { shell, collections } = data;
  const ui = shell.config?.ui ?? {};

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {(ui.hero_image || ui.hero_headline) && (
        <section className="mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-accent/5">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-10">
            <div className="flex-1 space-y-3">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {ui.hero_headline ?? shell.config.brand_name}
              </h2>
              {ui.hero_subline && (
                <p className="text-sm text-muted-foreground sm:text-base">{ui.hero_subline}</p>
              )}
            </div>
            {ui.hero_image && (
              <img
                src={ui.hero_image}
                alt=""
                decoding="async"
                fetchPriority="high"
                width={192}
                height={192}
                className="h-40 w-40 shrink-0 rounded-xl object-cover sm:h-48 sm:w-48"
              />
            )}
          </div>
        </section>
      )}

      {collections.length > 0 && (
        <section className="mb-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Категорії
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {collections.map((c) => (
              <Link
                key={c.id}
                to="/s/$slug/collections/$handle"
                params={{ slug, handle: c.handle }}
                className="group relative aspect-[3/2] overflow-hidden rounded-lg border bg-muted transition-shadow hover:shadow-md"
              >
                {c.image_url ? (
                  <img
                    src={c.image_url}
                    alt={c.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-primary/20 to-accent/10" />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <p className="text-sm font-semibold text-white">{c.name}</p>
                  <p className="text-xs text-white/80">{c.product_count} товарів</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">Усі товари</h2>
        <p className="text-sm text-muted-foreground">
          {shell.products.length} {pluralize(shell.products.length)} в наявності
        </p>
      </div>

      {shell.products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Поки що немає товарів.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shell.products.map((p) => (
            <ProductCard key={p.id} product={p} slug={slug} />
          ))}
        </div>
      )}
    </main>
  );
}

function pluralize(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return "товар";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "товари";
  return "товарів";
}
