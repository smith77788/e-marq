/**
 * Customer lifecycle distribution — radial donut + legend.
 * Splits customers into new / active / vip / at_risk / churned with revenue per stage.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { UsersRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type Customer = { lifecycle_stage: string; total_spent_cents: number; total_orders: number };

const STAGES = [
  { key: "vip", label: "VIP", color: "var(--primary)" },
  { key: "active", label: "Активні", color: "var(--accent)" },
  { key: "new", label: "Нові", color: "var(--success, var(--primary))" },
  { key: "at_risk", label: "Можуть піти", color: "var(--warning, var(--primary))" },
  { key: "churned", label: "Втрачені", color: "var(--destructive)" },
] as const;

function fmtUsd(cents: number) {
  if (cents >= 1_000_000) return `${(cents / 100_000).toFixed(1)} тис. ₴`;
  return `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;
}

export function LifecycleDistribution({ tenantId }: Props) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["lifecycle-dist", tenantId],
    enabled: !!tenantId,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("lifecycle_stage, total_spent_cents, total_orders")
        .eq("tenant_id", tenantId)
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  const slices = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number; orders: number }>();
    for (const s of STAGES) map.set(s.key, { count: 0, revenue: 0, orders: 0 });
    for (const c of data ?? []) {
      const key = STAGES.find((s) => s.key === c.lifecycle_stage)?.key ?? "new";
      const cur = map.get(key) ?? { count: 0, revenue: 0, orders: 0 };
      cur.count++;
      cur.revenue += c.total_spent_cents;
      cur.orders += c.total_orders;
      map.set(key, cur);
    }
    return STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      ...(map.get(s.key) ?? { count: 0, revenue: 0, orders: 0 }),
    }));
  }, [data]);

  const total = slices.reduce((s, sl) => s + sl.count, 0);
  const totalRev = slices.reduce((s, sl) => s + sl.revenue, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UsersRound className="h-4 w-4 text-primary" />
            Розподіл клієнтів за стадіями
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
            <UsersRound className="h-4 w-4 text-primary" />
            Розподіл клієнтів за стадіями
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UsersRound className="h-4 w-4 text-primary" />
          Розподіл клієнтів за стадіями
        </CardTitle>
        <CardDescription className="text-xs">
          {total.toLocaleString("uk-UA")} клієнтів · усього витратили {fmtUsd(totalRev)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Поки що клієнтів немає.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <div className="h-44 w-44 shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices.filter((s) => s.count > 0)}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="var(--background)"
                    strokeWidth={2}
                  >
                    {slices
                      .filter((s) => s.count > 0)
                      .map((s) => (
                        <Cell key={s.key} fill={s.color} />
                      ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "var(--popover-foreground)",
                    }}
                    formatter={(value: number, _name, p) => {
                      const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                      const slice = slices.find(
                        (s) => s.label === (p?.payload as { label: string })?.label,
                      );
                      return [
                        `${value} (${pct}%) · ${fmtUsd(slice?.revenue ?? 0)}`,
                        p?.payload?.label as string,
                      ];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-foreground">{total}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  клієнтів
                </span>
              </div>
            </div>
            <ul className="flex-1 space-y-1.5 text-xs w-full">
              {slices.map((s) => {
                const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                return (
                  <li
                    key={s.key}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: s.color }}
                      />
                      <span className="font-medium text-foreground">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span className="tabular-nums">
                        {s.count} · {pct}%
                      </span>
                      <span className="tabular-nums text-primary">{fmtUsd(s.revenue)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
