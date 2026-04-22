/**
 * Conversion funnel — sessions → product views → add to cart → checkout → purchase.
 * Pulled from `events` table, last 30d. Rendered as horizontal stacked bars
 * with drop-off percentages between steps.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter, TrendingDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

const STEPS: Array<{ key: string; label: string; types: string[] }> = [
  { key: "session", label: "Зайшли на сайт", types: ["session_start"] },
  { key: "view", label: "Переглянули товар", types: ["product_viewed"] },
  { key: "cart", label: "Додали в кошик", types: ["add_to_cart"] },
  { key: "checkout", label: "Почали оформлення", types: ["checkout_started"] },
  { key: "purchase", label: "Оплатили", types: ["purchase_completed"] },
];

const STEP_COLORS = [
  "color-mix(in oklab, var(--muted-foreground) 45%, transparent)",
  "color-mix(in oklab, var(--accent) 60%, transparent)",
  "color-mix(in oklab, var(--primary) 60%, transparent)",
  "color-mix(in oklab, var(--primary) 80%, transparent)",
  "color-mix(in oklab, var(--success, var(--primary)) 88%, transparent)",
];

export function FunnelChart({ tenantId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["funnel", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("events")
        .select("type, session_id")
        .eq("tenant_id", tenantId)
        .gte("created_at", since);
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = useMemo(() => {
    if (!data) return null;
    const out: Record<string, number> = {};
    for (const step of STEPS) {
      const set = new Set<string>();
      for (const e of data) {
        if (step.types.includes(e.type) && e.session_id) set.add(e.session_id);
      }
      out[step.key] = set.size || data.filter((e) => step.types.includes(e.type)).length;
    }
    return out;
  }, [data]);

  if (isLoading || !counts) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" />
            Лійка продажів
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 animate-pulse rounded-md bg-muted/30" />
        </CardContent>
      </Card>
    );
  }

  const max = Math.max(...STEPS.map((s) => counts[s.key]), 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Filter className="h-4 w-4 text-primary" />
          Лійка продажів · 30 днів
        </CardTitle>
        <CardDescription className="text-xs">
          Скільки людей доходить до оплати на кожному кроці.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {STEPS.map((step, i) => {
          const count = counts[step.key];
          const width = Math.max(4, (count / max) * 100);
          const prev = i > 0 ? counts[STEPS[i - 1].key] : 0;
          const dropoff = prev > 0 ? Math.round(((prev - count) / prev) * 100) : 0;
          return (
            <div key={step.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{step.label}</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {i > 0 && dropoff > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive/80">
                      <TrendingDown className="h-3 w-3" />−{dropoff}%
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-foreground">
                    {count.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="relative h-7 rounded-md bg-muted/30 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-all duration-700 ease-out"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(90deg, ${STEP_COLORS[i]}, ${STEP_COLORS[i]} 60%, color-mix(in oklab, var(--primary) 12%, transparent))`,
                    boxShadow:
                      i === STEPS.length - 1
                        ? "0 0 16px color-mix(in oklab, var(--success, var(--primary)) 45%, transparent)"
                        : "none",
                  }}
                />
                <div className="absolute inset-0 flex items-center px-2">
                  <span className="text-[10px] font-medium text-foreground/80">
                    {((count / max) * 100).toFixed(1)}% від першого кроку
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {counts.session === 0 && counts.view === 0 && (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-center text-[11px] text-muted-foreground">
            Поки що подій немає. Встановіть на сайт код відстеження — і тут зʼявиться жива лійка.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
