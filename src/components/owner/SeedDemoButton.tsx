/**
 * One-click demo data seeder so a brand-new owner can see how the dashboard
 * looks before they wire up their real Shopify/CSV/Telegram source.
 *
 * Renders only when the tenant has zero products. Calls `seed_demo_catalog`
 * RPC (SECURITY DEFINER, owner-only) which inserts 6 products / 3 customers
 * / 5 paid orders, all marked metadata.demo='true' for later cleanup via
 * `clear_demo_data`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export function SeedDemoButton({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["seed-demo-stats", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [prod, demoProd] = await Promise.all([
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("metadata->>demo", "true"),
      ]);
      return {
        total: prod.count ?? 0,
        demo: demoProd.count ?? 0,
      };
    },
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("seed_demo_catalog", { _tenant_id: tenantId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Демо-каталог додано", {
        description: "6 товарів · 3 клієнти · 5 замовлень за 14 днів",
      });
      qc.invalidateQueries({ queryKey: ["seed-demo-stats", tenantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clear = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clear_demo_data", { _tenant_id: tenantId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Демо-дані очищено");
      qc.invalidateQueries({ queryKey: ["seed-demo-stats", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Hide once the tenant has any non-demo data
  if (!stats) return null;
  const hasRealData = stats.total > stats.demo;
  if (hasRealData) return null;

  if (stats.demo > 0 && stats.total === stats.demo) {
    return (
      <Card className="border-accent/30 bg-accent/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-accent" />
            Зараз ви бачите демо-дані
          </CardTitle>
          <CardDescription>
            Це тестовий каталог, щоб ви відчули, як виглядає система. Підключіть справжнє джерело
            (Shopify, CSV, Telegram) — і дані замінять демо. Або очистіть демо вручну.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="outline"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            {clear.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-3.5 w-3.5" />
            )}
            Очистити демо-дані
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Хочете швидко побачити, як це працює?
        </CardTitle>
        <CardDescription>
          Створимо тестовий каталог: 6 товарів, 3 клієнти, 5 замовлень за 14 днів. Дашборд, графіки
          й AI-агенти одразу заживуть. Потім очистите одним кліком.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Заповнити демо-каталогом
        </Button>
      </CardContent>
    </Card>
  );
}
