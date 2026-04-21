import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { CHART, CHART_SCALE } from "@/lib/chartColors";

type Props = { tenantId: string };

const FUNNEL_STEPS = [
  { type: "content_viewed", label: "Перегляд сторінки" },
  { type: "product_viewed", label: "Перегляд товару" },
  { type: "add_to_cart", label: "У кошик" },
  { type: "checkout_started", label: "Оформлення" },
  { type: "purchase_completed", label: "Покупка" },
] as const;

function startOfDayISO(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function TenantAnalytics({ tenantId }: Props) {
  const fromIso = startOfDayISO(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));

  const funnelQuery = useQuery({
    queryKey: ["tenant-funnel", tenantId, fromIso],
    enabled: !!tenantId,
    queryFn: async () => {
      const counts: Record<string, number> = {};
      for (const step of FUNNEL_STEPS) {
        const { count, error } = await supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("type", step.type)
          .gte("created_at", fromIso);
        if (error) throw error;
        counts[step.type] = count ?? 0;
      }
      const top = counts[FUNNEL_STEPS[0].type] || 1;
      return FUNNEL_STEPS.map((s) => ({
        step: s.label,
        count: counts[s.type],
        rate: Math.round((counts[s.type] / top) * 100),
      }));
    },
  });

  const revenueQuery = useQuery({
    queryKey: ["tenant-revenue", tenantId, fromIso],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, total_cents, status")
        .eq("tenant_id", tenantId)
        .eq("status", "paid")
        .gte("created_at", fromIso)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;

      const buckets = new Map<string, number>();
      // pre-fill 30 days with 0
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        buckets.set(dayKey(d), 0);
      }
      for (const o of data ?? []) {
        const k = dayKey(new Date(o.created_at));
        if (buckets.has(k)) {
          buckets.set(k, (buckets.get(k) ?? 0) + o.total_cents);
        }
      }
      return Array.from(buckets.entries()).map(([date, cents]) => ({
        date: date.slice(5), // MM-DD
        revenue: cents / 100,
      }));
    },
  });

  const totalRevenue =
    revenueQuery.data?.reduce((sum, d) => sum + d.revenue, 0) ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Воронка конверсії</CardTitle>
          <CardDescription>Останні 30 днів. % від першого кроку.</CardDescription>
        </CardHeader>
        <CardContent>
          {funnelQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : funnelQuery.data && funnelQuery.data.some((d) => d.count > 0) ? (
            <div className="space-y-3">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={funnelQuery.data}
                    layout="vertical"
                    margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray={CHART.gridDash} stroke={CHART.gridStroke} />
                    <XAxis type="number" stroke={CHART.muted} fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="step"
                      stroke={CHART.muted}
                      fontSize={11}
                      width={100}
                    />
                    <Tooltip
                      contentStyle={CHART.tooltipStyle}
                      cursor={{ fill: CHART.cursorFill }}
                      formatter={(value: number, _name: string, item) => {
                        const rate = (item.payload as { rate: number }).rate;
                        return [`${value.toLocaleString("uk-UA")} (${rate}%)`, "Подій"];
                      }}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} animationDuration={600}>
                      {funnelQuery.data.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_SCALE[Math.min(i, CHART_SCALE.length - 1)]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                {funnelQuery.data.map((d) => (
                  <div key={d.step}>
                    <p className="font-semibold text-foreground">{d.rate}%</p>
                    <p className="truncate text-muted-foreground">{d.step}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Подій ще немає. Згенеруйте демо-дані, щоб побачити воронку.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Виторг (30 днів)</CardTitle>
          <CardDescription>
            {totalRevenue.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴ загалом з оплачених замовлень.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revenueQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : revenueQuery.data && revenueQuery.data.length > 0 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={revenueQuery.data}
                  margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray={CHART.gridDash} stroke={CHART.gridStroke} />
                  <XAxis
                    dataKey="date"
                    stroke={CHART.muted}
                    fontSize={11}
                    interval={4}
                  />
                  <YAxis
                    stroke={CHART.muted}
                    fontSize={11}
                    tickFormatter={(v: number) => `${v} ₴`}
                  />
                  <Tooltip
                    contentStyle={CHART.tooltipStyle}
                    cursor={{ stroke: CHART.cursorFill, strokeWidth: 1 }}
                    formatter={(v: number) => [`${v.toFixed(2)} ₴`, "Виторг"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke={CHART.primary}
                    strokeWidth={2.5}
                    dot={false}
                    animationDuration={600}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">За останні 30 днів оплачених замовлень немає.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
