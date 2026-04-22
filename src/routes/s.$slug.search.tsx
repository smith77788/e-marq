/**
 * Storefront search page — client-side fuzzy filter over the cached
 * product list. Reads `?q=` from URL.
 */
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { loadStorefrontShell, type StorefrontShell } from "@/lib/storefront/loaders";
import { ProductCard } from "@/components/storefront/ProductCard";
import { z } from "zod";

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/s/$slug/search")({
  validateSearch: (search) => searchSchema.parse(search),
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: ({ loaderData }) => ({
    meta: [
      { title: `Пошук — ${loaderData?.config?.brand_name ?? "Магазин"}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка пошуку: {error.message}</p>
    </div>
  ),
  component: SearchPage,
});

function SearchPage() {
  const { slug } = Route.useParams();
  const { q } = Route.useSearch();
  const initial = Route.useLoaderData();

  const { data } = useQuery<StorefrontShell>({
    queryKey: ["storefront-shell", slug],
    queryFn: () => loadStorefrontShell(slug),
    initialData: initial,
    staleTime: 5 * 60_000,
  });

  const query = (q ?? "").trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return [];
    return data.products.filter((p) => {
      const haystack = [p.name, p.description ?? "", ...(p.tags ?? [])].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [data.products, query]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          {query ? `Результати пошуку: "${q}"` : "Пошук"}
        </h1>
        {query && (
          <p className="text-sm text-muted-foreground">
            Знайдено {results.length} {results.length === 1 ? "товар" : "товарів"}
          </p>
        )}
      </div>

      {!query ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Введіть запит в полі пошуку зверху.
          </CardContent>
        </Card>
      ) : results.length === 0 ? (
        <div className="space-y-6">
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Нічого не знайдено за запитом «{q}».
            </CardContent>
          </Card>
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Популярні товари
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.products.slice(0, 4).map((p) => (
                <ProductCard key={p.id} product={p} slug={slug} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((p) => (
            <ProductCard key={p.id} product={p} slug={slug} />
          ))}
        </div>
      )}
    </main>
  );
}
