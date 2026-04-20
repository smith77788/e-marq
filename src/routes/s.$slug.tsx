import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type TenantRow = { id: string; name: string; slug: string; status: string };
type ConfigRow = {
  brand_name: string;
  ui: Record<string, unknown> | null;
  seo: Record<string, unknown> | null;
};
type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  stock: number;
};

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "acos_session_id";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

function track(
  tenantId: string,
  type: "content_viewed" | "product_viewed" | "add_to_cart",
  extra: { product_id?: string; payload?: Record<string, unknown> } = {},
) {
  void supabase.from("events").insert({
    tenant_id: tenantId,
    type,
    session_id: getSessionId(),
    product_id: extra.product_id ?? null,
    payload: { ts: new Date().toISOString(), ...(extra.payload ?? {}) },
  });
}

async function loadStorefront(slug: string) {
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, slug, status")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw notFound();

  const [{ data: config, error: cErr }, { data: products, error: pErr }] = await Promise.all([
    supabase
      .from("tenant_configs")
      .select("brand_name, ui, seo")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id, name, description, price_cents, currency, image_url, stock")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;

  return {
    tenant: tenant as TenantRow,
    config: (config ?? null) as ConfigRow | null,
    products: (products ?? []) as Product[],
  };
}

export const Route = createFileRoute("/s/$slug")({
  loader: ({ params }) => loadStorefront(params.slug),
  head: ({ loaderData }) => {
    const brand = loaderData?.config?.brand_name ?? loaderData?.tenant.name ?? "Store";
    const seo = (loaderData?.config?.seo ?? {}) as {
      title?: string;
      description?: string;
      og_image?: string;
    };
    const title = seo.title ?? `${brand} — Shop`;
    const description = seo.description ?? `Shop products from ${brand}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(seo.og_image ? [{ property: "og:image", content: seo.og_image }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-foreground">Store not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This storefront does not exist or has been disabled.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go home
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-destructive">Failed to load store: {error.message}</p>
    </div>
  ),
  component: StorefrontPage,
});

function StorefrontPage() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();

  // Re-query on client so add-to-cart / refresh stays fresh, but seed from loader
  const { data } = useQuery({
    queryKey: ["storefront", slug],
    queryFn: () => loadStorefront(slug),
    initialData: initial,
    staleTime: 30_000,
  });

  const tenant = data.tenant;
  const config = data.config;
  const products = data.products;
  const brand = config?.brand_name ?? tenant.name;

  const ui = (config?.ui ?? {}) as { primary?: string; accent?: string };
  const themeStyle = useMemo(() => {
    const style: Record<string, string> = {};
    if (ui.primary) style["--primary"] = ui.primary;
    if (ui.accent) style["--accent"] = ui.accent;
    return style as React.CSSProperties;
  }, [ui.primary, ui.accent]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);

  // page view (once per mount)
  useEffect(() => {
    track(tenant.id, "content_viewed", { payload: { path: `/s/${slug}` } });
  }, [tenant.id, slug]);

  return (
    <div className="min-h-screen bg-background" style={themeStyle}>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-foreground">{brand}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShoppingCart className="h-4 w-4" />
            <span>{cartCount}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">Shop</h2>
          <p className="text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? "product" : "products"} available
          </p>
        </div>

        {products.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No products available yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                tenantId={tenant.id}
                inCart={cart[p.id] ?? 0}
                onAdd={() => {
                  setCart((prev) => ({ ...prev, [p.id]: (prev[p.id] ?? 0) + 1 }));
                  track(tenant.id, "add_to_cart", {
                    product_id: p.id,
                    payload: { quantity: 1, price_cents: p.price_cents },
                  });
                  toast.success(`Added ${p.name}`);
                }}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground">
          Powered by ACOS · /{tenant.slug}
        </div>
      </footer>
    </div>
  );
}

function ProductCard({
  product,
  tenantId,
  inCart,
  onAdd,
}: {
  product: Product;
  tenantId: string;
  inCart: number;
  onAdd: () => void;
}) {
  const [viewed, setViewed] = useState(false);

  // Track product_viewed when card mounts (debounced via flag)
  useEffect(() => {
    if (viewed) return;
    const t = setTimeout(() => {
      track(tenantId, "product_viewed", { product_id: product.id });
      setViewed(true);
    }, 300);
    return () => clearTimeout(t);
  }, [tenantId, product.id, viewed]);

  const price = (product.price_cents / 100).toFixed(2);
  const outOfStock = product.stock <= 0;

  return (
    <Card className="overflow-hidden">
      {product.image_url ? (
        <div className="aspect-square w-full overflow-hidden bg-muted">
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted">
          <span className="text-xs text-muted-foreground">No image</span>
        </div>
      )}
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-medium text-foreground">{product.name}</h3>
          <Badge variant="outline" className="shrink-0">
            {price} {product.currency}
          </Badge>
        </div>
        {product.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{product.description}</p>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={outOfStock}
          onClick={onAdd}
        >
          {outOfStock ? (
            "Out of stock"
          ) : inCart > 0 ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              In cart ({inCart})
            </>
          ) : (
            <>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Add to cart
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
