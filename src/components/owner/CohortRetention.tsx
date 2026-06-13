/**
 * Cohort retention heatmap — reads from customer_cohorts (computed daily by
 * compute_customer_cohorts() SQL agent #18). Falls back to derived 6-month
 * estimate from customers.first_order_at + last_order_at when cohorts table
 * is empty (e.g. brand new tenant).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type CohortRow = {
  cohort_month: string;
  customer_count: number;
  retention_curve: { m: number; c: number }[] | null;
  revenue_curve: { m: number; r: number }[] | null;
};

type CustomerFallback = { first_order_at: string | null; last_order_at: string | null };

function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(a: Date, b: Date) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

const MAX_OFFSET = 11;

export function CohortRetention({ tenantId }: Props) {
  const { data: cohorts, isLoading, isError, refetch } = useQuery({
    queryKey: ["customer-cohorts", tenantId],
    enabled: !!tenantId,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_cohorts")
        .select("cohort_month, customer_count, retention_curve, revenue_curve")
        .eq("tenant_id", tenantId)
        .order("cohort_month", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CohortRow[];
    },
  });

  const { data: fallback } = useQuery({
    queryKey: ["customer-cohorts-fallback", tenantId],
    enabled: !!tenantId && (cohorts?.length ?? 0) === 0 && !isLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("first_order_at, last_order_at")
        .eq("tenant_id", tenantId)
        .not("first_order_at", "is", null)
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as CustomerFallback[];
    },
  });

  const grid = useMemo(() => {
    // Server-side cohorts (from customer_cohorts table)
    if (cohorts && cohorts.length > 0) {
      const rows = cohorts.map((row) => {
        const ret: Record<number, number> = {};
        for (const p of row.retention_curve ?? []) {
          if (typeof p?.m === "number" && typeof p?.c === "number") ret[p.m] = p.c;
        }
        return {
          key: row.cohort_month.slice(0, 7),
          size: row.customer_count,
          retention: ret,
        };
      });
      return { rows, source: "server" as const };
    }
    // Client-side derived fallback (last 6 months)
    const cohortKeys: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      cohortKeys.push(ymKey(d));
    }
    const sizes = new Map<string, number>();
    const retention = new Map<string, Record<number, number>>();
    cohortKeys.forEach((k) => {
      sizes.set(k, 0);
      retention.set(k, {});
    });
    for (const c of fallback ?? []) {
      if (!c.first_order_at) continue;
      const first = new Date(c.first_order_at);
      const cohort = ymKey(first);
      if (!sizes.has(cohort)) continue;
      sizes.set(cohort, (sizes.get(cohort) ?? 0) + 1);
      const last = c.last_order_at ? new Date(c.last_order_at) : first;
      const span = Math.min(5, monthsBetween(first, last));
      const m = retention.get(cohort)!;
      for (let i = 0; i <= span; i++) m[i] = (m[i] ?? 0) + 1;
    }
    const rows = cohortKeys.map((k) => ({
      key: k,
      size: sizes.get(k) ?? 0,
      retention: retention.get(k) ?? {},
    }));
    return { rows, source: "fallback" as const };
  }, [cohorts, fallback]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-primary" />
            Утримання покупців по місяцях
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 animate-pulse rounded-md bg-muted/30" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-primary" />
            Утримання покупців по місяцях
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Не вдалося завантажити.{" "}
            <button type="button" className="underline" onClick={() => void refetch()}>
              Повторити
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalCustomers = grid.rows.reduce((s, r) => s + r.size, 0);
  const offsets =
    grid.source === "server"
      ? Array.from({ length: MAX_OFFSET + 1 }, (_, i) => i)
      : [0, 1, 2, 3, 4, 5];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="h-4 w-4 text-primary" />
          Утримання покупців · {grid.source === "server" ? "12 місяців" : "6 місяців"}
        </CardTitle>
        <CardDescription className="text-xs">
          {grid.source === "server"
            ? "Точна агрегація: для кожної когорти показано % покупців, що повернулися у наступні місяці."
            : "Попередня оцінка по first/last_order_at. Точні дані з'являться після першого розрахунку (щоденно 03:45 UTC)."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {totalCustomers === 0 ? (
          <EmptyState
            variant="inline"
            icon={Layers}
            title="Поки немає даних для когорт"
            description="Потрібен хоча б один покупець із першим замовленням, щоб побудувати retention-карту."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left px-2 py-1 font-medium">Місяць</th>
                  <th className="text-right px-2 py-1 font-medium">Покупців</th>
                  {offsets.map((m) => (
                    <th key={m} className="text-center px-1 py-1 font-medium">
                      +{m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border/50">
                    <td className="px-2 py-1.5 font-mono text-foreground">{row.key}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{row.size}</td>
                    {offsets.map((m) => {
                      const count = row.retention[m] ?? 0;
                      const pct = row.size > 0 ? (count / row.size) * 100 : 0;
                      const intensity = Math.min(1, pct / 100);
                      const bgPct = Math.round(8 + intensity * 70);
                      const bg = `color-mix(in oklab, var(--primary) ${bgPct}%, transparent)`;
                      return (
                        <td key={m} className="px-0.5 py-0.5">
                          <div
                            className="flex h-7 items-center justify-center rounded text-[10px] font-medium transition-colors"
                            style={{
                              background: bg,
                              color:
                                intensity > 0.45
                                  ? "var(--primary-foreground)"
                                  : "var(--foreground)",
                            }}
                            title={`${pct.toFixed(0)}% повернулися через ${m} міс. (${count} з ${row.size})`}
                          >
                            {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Менше повернень</span>
              {[8, 25, 45, 65, 80].map((p) => (
                <span
                  key={p}
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: `color-mix(in oklab, var(--primary) ${p}%, transparent)` }}
                />
              ))}
              <span>Більше повернень</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
