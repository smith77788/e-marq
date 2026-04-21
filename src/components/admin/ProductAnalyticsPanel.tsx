/**
 * Product Analytics panel — last 30 days of views, cart-adds and purchases
 * for a single product, derived from the `events` table.
 *
 * Reads three event types: `product_viewed`, `add_to_cart`, `purchase_completed`.
 * Purchases include this product when `payload.items` contains its id, OR
 * when an associated `order_items` row references this product. We use the
 * cheaper events-only signal here for speed; the dashboard already has full
 * order analytics.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, ShoppingBag, ShoppingCart, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  tenantId: string;
  productId: string;
};

type EventRow = {
  type: string;
  created_at: string;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export function ProductAnalyticsPanel({ tenantId, productId }: Props) {
  const eventsQuery = useQuery({
    queryKey: ["product-events", productId],
    queryFn: async () => {
      const since = daysAgoIso(30);
      const { data, error } = await supabase
        .from("events")
        .select("type, created_at")
        .eq("tenant_id", tenantId)
        .eq("product_id", productId)
        .gte("created_at", since)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const stats = useMemo(() => {
    const e = eventsQuery.data ?? [];
    const views = e.filter((x) => x.type === "product_viewed").length;
    const adds = e.filter((x) => x.type === "add_to_cart").length;
    const purchases = e.filter((x) => x.type === "purchase_completed").length;
    const cvr = views > 0 ? Math.round((purchases / views) * 1000) / 10 : 0;
    return { views, adds, purchases, cvr };
  }, [eventsQuery.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Аналітика · 30 днів</CardTitle>
        <CardDescription>Перегляди, додавання в кошик і покупки цього товару.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Eye} label="Перегляди" value={stats.views} />
        <Stat icon={ShoppingCart} label="У кошик" value={stats.adds} />
        <Stat icon={ShoppingBag} label="Покупки" value={stats.purchases} />
        <Stat icon={TrendingUp} label="Конверсія" value={`${stats.cvr}%`} />
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
