/**
 * Storefront homepage: announcement hero, trust badges, collections strip,
 * full product grid.
 */
import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Package, Sparkles, Tag } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadStorefrontShell,
  loadCollections,
  loadCollectionProducts,
  type CollectionSummary,
  type StorefrontShell,
} from "@/lib/storefront/loaders";
import { ProductCard } from "@/components/storefront/ProductCard";
import { CatalogFilters } from "@/components/storefront/CatalogFilters";
import {
  applyCatalogFilters,
  catalogFiltersSchema,
  countActiveFilters,
  type CatalogFilters as CatalogFilterValues,
} from "@/lib/storefront/catalogFilters";
import { canonicalUrl } from "@/lib/seo";
import { storefrontIndexJsonLd } from "@/lib/storefront/jsonLd";

type SortOpt = "default" | "price_asc" | "price_desc" | "name_asc";

const searchSchema = z
  .object({
    sort: z.enum(["default", "price_asc", "price_desc", "name_asc"]).optional().catch(undefined),
  })
  .merge(catalogFiltersSchema);

export const Route = createFileRoute("/s/$slug/")({
  validateSearch: (search) => searchSchema.parse(search),
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
  errorComponent: ({ error }: { error: Error }) => {
    const isConfigError =
      error.message?.includes("Missing Supabase") || error.message?.includes("environment variables");
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 text-center">
        <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
        <p className="font-semibold text-foreground">
          {isConfigError ? "Магазин тимчасово недоступний" : "Помилка завантаження"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isConfigError
            ? "Ми вже працюємо над відновленням. Спробуйте оновити сторінку за кілька хвилин."
            : "Щось пішло не так. Спробуйте оновити сторінку."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Оновити
        </button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-6xl px-4 py-12 text-center">
      <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">Магазин не знайдено.</p>
      <Link to="/" className="mt-3 inline-flex text-sm text-primary underline">
        На головну
      </Link>
    </div>
  ),
  component: StorefrontIndex,
});

function StorefrontIndex() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
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
  const ui = (shell.config?.ui ?? {}) as Record<string, string>;

  const search = Route.useSearch();
  const sort: SortOpt = search.sort ?? "default";
  const filters: CatalogFilterValues = {
    price_min: search.price_min,
    price_max: search.price_max,
    in_stock: search.in_stock,
    collection: search.collection,
  };

  const collectionProductsQuery = useQuery<ReadonlySet<string>>({
    queryKey: ["collection-products", slug, filters.collection],
    enabled: !!filters.collection,
    queryFn: async () => {
      const items = await loadCollectionProducts(slug, filters.collection!);
      return new Set(items.products.map((p) => p.id));
    },
    staleTime: 60_000,
  });

  const visibleProducts = useMemo(() => {
    const sorted = (() => {
      const list = [...shell.products];
      switch (sort) {
        case "price_asc":
          return list.sort((a, b) => a.price_cents - b.price_cents);
        case "price_desc":
          return list.sort((a, b) => b.price_cents - a.price_cents);
        case "name_asc":
          return list.sort((a, b) => a.name.localeCompare(b.name, "uk"));
        default:
          return list;
      }
    })();
    return applyCatalogFilters(sorted, filters, collectionProductsQuery.data);
  }, [shell.products, sort, filters, collectionProductsQuery.data]);

  const hasHero = !!(ui.hero_image || ui.hero_headline);
  const discountedProducts = shell.products.filter(
    (p) => p.compare_at_price_cents && p.compare_at_price_cents > p.price_cents,
  );
  const inStockProducts = shell.products.filter((p) => p.stock > 0);
  const activeFilterCount = countActiveFilters(filters);
  const outOfStockCount = shell.products.filter((p) => p.stock <= 0).length;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      {/* ─── Hero ─────────────────────────────────────────── */}
      {hasHero ? (
        <HeroSection ui={ui} brand={shell.config?.brand_name ?? ""} slug={slug} />
      ) : (
        <DefaultHero
          brand={shell.config?.brand_name ?? ""}
          slug={slug}
          productCount={shell.products.length}
        />
      )}

      {/* ─── Collections strip ────────────────────────────── */}
      {collections.length > 0 && (
        <section className="mb-12">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">Категорії</h2>
            <span className="text-xs text-muted-foreground">{collections.length} категорій</span>
          </div>
          <div
            className={`grid gap-3 ${
              collections.length === 1
                ? "grid-cols-1"
                : collections.length === 2
                  ? "grid-cols-2"
                  : collections.length === 3
                    ? "sm:grid-cols-3"
                    : "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {collections.map((c) => (
              <CollectionCard key={c.id} collection={c} slug={slug} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Sale strip ───────────────────────────────────── */}
      {discountedProducts.length > 0 && (
        <section className="mb-12">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
              <Tag className="h-5 w-5 text-destructive" />
              Акції та знижки
            </h2>
            <Badge variant="destructive" className="text-xs">
              -{discountedProducts.length} товарів
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {discountedProducts.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} slug={slug} />
            ))}
          </div>
        </section>
      )}

      {/* ─── All products ─────────────────────────────────── */}
      <section>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Усі товари</h2>
            <p className="text-sm text-muted-foreground">
              {inStockProducts.length} в наявності
              {outOfStockCount > 0 && ` · ${outOfStockCount} закінчились`}
            </p>
          </div>
          {shell.products.length > 1 && (
            <div className="flex items-center gap-2">
              <CatalogFilters
                value={filters}
                onChange={(next) =>
                  void navigate({ to: "/s/$slug/", params: { slug }, search: { ...search, ...next } })
                }
                collections={collections.map((c) => ({ handle: c.handle, name: c.name }))}
              />
              <Select
                value={sort}
                onValueChange={(v) =>
                  void navigate({ to: "/s/$slug/", params: { slug }, search: { ...search, sort: v as SortOpt } })
                }
              >
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">За замовчуванням</SelectItem>
                  <SelectItem value="price_asc">Спочатку дешевші</SelectItem>
                  <SelectItem value="price_desc">Спочатку дорожчі</SelectItem>
                  <SelectItem value="name_asc">За назвою (А–Я)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {shell.products.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 py-20 text-center">
            <Package className="mb-4 h-16 w-16 text-muted-foreground/30" />
            <p className="font-semibold text-foreground">Поки що немає товарів</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Незабаром тут з'являться нові товари.
            </p>
          </div>
        ) : visibleProducts.length === 0 && activeFilterCount > 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 py-16 text-center">
            <p className="font-semibold text-foreground">Нічого не знайдено</p>
            <p className="mt-1 text-sm text-muted-foreground">Змініть або скиньте фільтри</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() =>
                void navigate({ to: "/s/$slug/", params: { slug }, search: { sort: search.sort } })
              }
            >
              Скинути фільтри
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleProducts.map((p) => (
              <ProductCard key={p.id} product={p} slug={slug} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function HeroSection({
  ui,
  brand,
  slug,
}: {
  ui: Record<string, string>;
  brand: string;
  slug: string;
}) {
  return (
    <section className="mb-12 mt-6 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/15 via-background to-accent/10 ring-1 ring-border/50">
      <div className="flex flex-col items-center gap-6 p-8 sm:flex-row sm:p-12">
        <div className="flex-1 space-y-4">
          {ui.hero_badge && (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
              <Sparkles className="mr-1 h-3 w-3" />
              {ui.hero_badge}
            </Badge>
          )}
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            {ui.hero_headline ?? brand}
          </h1>
          {ui.hero_subline && (
            <p className="max-w-md text-base text-muted-foreground sm:text-lg">{ui.hero_subline}</p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link to="/s/$slug" params={{ slug }}>
              <Button size="lg" className="gap-2">
                {ui.hero_cta_text ?? "Переглянути каталог"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        {ui.hero_image && (
          <div className="shrink-0">
            <img
              src={ui.hero_image}
              alt={brand}
              decoding="async"
              fetchPriority="high"
              width={320}
              height={320}
              className="h-48 w-48 rounded-2xl object-cover shadow-lg sm:h-64 sm:w-64"
            />
          </div>
        )}
      </div>
    </section>
  );
}

function DefaultHero({
  brand,
  slug,
  productCount,
}: {
  brand: string;
  slug: string;
  productCount: number;
}) {
  return (
    <section className="mb-12 mt-6 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-background to-accent/5 px-8 py-12 text-center sm:px-12 sm:py-16">
      <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
        {brand}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">
        {productCount > 0
          ? `${productCount} ${pluralize(productCount)} для вас`
          : "Відкрийте для себе наш каталог"}
      </p>
      <Link to="/s/$slug" params={{ slug }}>
        <Button size="lg" className="mt-6 gap-2">
          Переглянути товари
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </section>
  );
}

function CollectionCard({ collection, slug }: { collection: CollectionSummary; slug: string }) {
  return (
    <Link
      to="/s/$slug/collections/$handle"
      params={{ slug, handle: collection.handle }}
      className="group relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      {collection.image_url ? (
        <img
          src={collection.image_url}
          alt={collection.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-muted to-accent/10">
          <Package className="h-10 w-10 text-muted-foreground/40" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="text-sm font-bold text-white drop-shadow-sm">{collection.name}</p>
        <p className="mt-0.5 text-xs text-white/80">
          {collection.product_count} товар{collection.product_count === 1 ? "" : "ів"}
        </p>
      </div>
    </Link>
  );
}

function pluralize(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return "товар";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "товари";
  return "товарів";
}
