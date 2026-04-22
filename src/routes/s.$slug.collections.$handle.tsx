/**
 * Storefront collection detail — products inside a single collection.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadCollectionProducts } from "@/lib/storefront/loaders";
import { ProductCard } from "@/components/storefront/ProductCard";
import { useT, tStatic } from "@/lib/i18n";
import { canonicalUrl } from "@/lib/seo";
import { collectionJsonLd, breadcrumbJsonLd } from "@/lib/storefront/jsonLd";

type SortOpt = "manual" | "price_asc" | "price_desc" | "name_asc";

export const Route = createFileRoute("/s/$slug/collections/$handle")({
  loader: ({ params }) => loadCollectionProducts(params.slug, params.handle),
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [] };
    const c = loaderData.collection;
    const title = c.seo_title ?? c.name;
    const description = c.seo_description ?? c.description ?? `${c.name} — товари в наявності.`;
    const url = canonicalUrl(`/s/${params.slug}/collections/${params.handle}`);
    return {
      meta: [
        { title },
        { name: "description", content: description.slice(0, 160) },
        { property: "og:title", content: title },
        { property: "og:description", content: description.slice(0, 160) },
        { property: "og:url", content: url },
        ...(c.image_url ? [{ property: "og:image", content: c.image_url }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(collectionJsonLd(loaderData, params.slug)),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbJsonLd([
              { name: tStatic("sf.breadcrumb.shop"), path: `/s/${params.slug}` },
              { name: c.name, path: `/s/${params.slug}/collections/${params.handle}` },
            ]),
          ),
        },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">{tStatic("sf.collection.notFound")}</p>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">
        {tStatic("sf.collection.error")}: {error.message}
      </p>
    </div>
  ),
  component: CollectionPage,
});

function CollectionPage() {
  const { slug, handle } = Route.useParams();
  const initial = Route.useLoaderData();
  const { t } = useT();

  const { data } = useQuery({
    queryKey: ["storefront-collection", slug, handle],
    queryFn: () => loadCollectionProducts(slug, handle),
    initialData: initial,
    staleTime: 30_000,
  });

  const [sort, setSort] = useState<SortOpt>("manual");

  const sorted = useMemo(() => {
    const list = [...data.products];
    switch (sort) {
      case "price_asc":
        return list.sort((a, b) => a.price_cents - b.price_cents);
      case "price_desc":
        return list.sort((a, b) => b.price_cents - a.price_cents);
      case "name_asc":
        return list.sort((a, b) => a.name.localeCompare(b.name, "uk"));
      default:
        return list.sort((a, b) => a.position - b.position);
    }
  }, [data.products, sort]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {data.collection.name}
        </h1>
        {data.collection.description && (
          <p className="text-sm text-muted-foreground">{data.collection.description}</p>
        )}
      </header>

      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data.products.length} {t("sf.collection.countSuffix")}
        </p>
        <Select value={sort} onValueChange={(v) => setSort(v as SortOpt)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">{t("sf.collection.sort.manual")}</SelectItem>
            <SelectItem value="price_asc">{t("sf.collection.sort.priceAsc")}</SelectItem>
            <SelectItem value="price_desc">{t("sf.collection.sort.priceDesc")}</SelectItem>
            <SelectItem value="name_asc">{t("sf.collection.sort.nameAsc")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t("sf.collection.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <ProductCard key={p.id} product={p} slug={slug} />
          ))}
        </div>
      )}
    </main>
  );
}
