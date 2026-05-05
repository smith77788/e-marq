/**
 * "Часто купують з цим" — storefront widget showing bundle suggestions for a product.
 * Powered by `bundle_suggestions` table (SQL Agent #12) via storefront_bundle_recommendations RPC.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatMoneyExact } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  tenantId: string;
  productId: string;
  slug: string;
}

interface Recommendation {
  product_id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  lift: number;
  co_orders: number;
}

export function FrequentlyBoughtTogether({ tenantId, productId, slug }: Props) {
  const { data } = useQuery<Recommendation[]>({
    queryKey: ["bundle-recs", tenantId, productId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("storefront_bundle_recommendations", {
        _tenant_id: tenantId,
        _product_id: productId,
        _limit: 4,
      });
      if (error) throw error;
      return (data ?? []) as Recommendation[];
    },
    staleTime: 5 * 60_000,
    enabled: !!tenantId && !!productId,
  });

  if (!data || data.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="fbt-heading">
      <h2 id="fbt-heading" className="mb-4 text-lg font-semibold text-foreground">
        Часто купують з цим
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.map((r) => (
          <Link
            key={r.product_id}
            to="/s/$slug/products/$productId"
            params={{ slug, productId: r.product_id }}
            className="group block"
          >
            <Card className="overflow-hidden transition-shadow hover:shadow-md">
              <div className="aspect-square w-full overflow-hidden bg-muted">
                {r.image_url ? (
                  <img
                    src={r.image_url}
                    alt={r.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    Без фото
                  </div>
                )}
              </div>
              <CardContent className="p-3">
                <p className="line-clamp-2 text-sm font-medium text-foreground">{r.name}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {formatMoneyExact(r.price_cents)}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
