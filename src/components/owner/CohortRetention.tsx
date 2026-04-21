/**
 * Cohort retention heatmap — last 6 monthly cohorts × 6 months retention.
 * Reads from customer_cohorts (computed by cohort-engine agent) when available,
 * otherwise derives a basic heatmap from customers.first_order_at + last_order_at.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type Customer = { first_order_at: string | null; last_order_at: string | null };

function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(a: Date, b: Date) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export function CohortRetention({ tenantId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["cohort-retention", tenantId],
    enabled: !!tenantId,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("first_order_at, last_order_at")
        .eq("tenant_id", tenantId)
        .not("first_order_at", "is", null);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  const grid = useMemo(() => {
    const cohortKeys: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      cohortKeys.push(ymKey(d));
    }
    const cohortSizes = new Map<string, number>();
    const retention = new Map<string, Map<number, number>>();
    cohortKeys.forEach((k) => {
      cohortSizes.set(k, 0);
      retention.set(k, new Map());
    });
    for (const c of data ?? []) {
      if (!c.first_order_at) continue;
      const first = new Date(c.first_order_at);
      const cohort = ymKey(first);
      if (!cohortSizes.has(cohort)) continue;
      cohortSizes.set(cohort, (cohortSizes.get(cohort) ?? 0) + 1);
      const last = c.last_order_at ? new Date(c.last_order_at) : first;
      const span = Math.min(5, monthsBetween(first, last));
      const m = retention.get(cohort);
      if (m) {
        for (let i = 0; i <= span; i++) {
          m.set(i, (m.get(i) ?? 0) + 1);
        }
      }
    }
    return { cohortKeys, cohortSizes, retention };
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-primary" />
            Утримання покупців по місяцях
          </CardTitle>
        </CardHeader>
        <CardContent><div className="h-48 animate-pulse rounded-md bg-muted/30" /></CardContent>
      </Card>
    );
  }

  const totalCustomers = Array.from(grid.cohortSizes.values()).reduce((s, n) => s + n, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="h-4 w-4 text-primary" />
          Утримання покупців · 6 місяців
        </CardTitle>
        <CardDescription className="text-xs">
          Скільки % покупців із кожного місяця продовжують купувати в наступні. Яскравіше — більше повертаються.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {totalCustomers === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Поки немає даних. Потрібен хоча б один покупець із першим замовленням.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left px-2 py-1 font-medium">Місяць</th>
                  <th className="text-right px-2 py-1 font-medium">Покупців</th>
                  {[0, 1, 2, 3, 4, 5].map((m) => (
                    <th key={m} className="text-center px-1 py-1 font-medium">+{m} міс</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.cohortKeys.map((k) => {
                  const size = grid.cohortSizes.get(k) ?? 0;
                  const ret = grid.retention.get(k) ?? new Map();
                  return (
                    <tr key={k} className="border-t border-border/50">
                      <td className="px-2 py-1.5 font-mono text-foreground">{k}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">{size}</td>
                      {[0, 1, 2, 3, 4, 5].map((m) => {
                        const count = ret.get(m) ?? 0;
                        const pct = size > 0 ? (count / size) * 100 : 0;
                        const intensity = Math.min(1, pct / 100);
                        const bg = `hsl(var(--primary) / ${0.05 + intensity * 0.6})`;
                        return (
                          <td key={m} className="px-0.5 py-0.5">
                            <div
                              className="flex h-7 items-center justify-center rounded text-[10px] font-medium"
                              style={{
                                background: bg,
                                color: intensity > 0.4 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                                boxShadow: intensity > 0.5 ? "0 0 8px hsl(var(--primary) / 0.3)" : "none",
                              }}
                            >
                              {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
