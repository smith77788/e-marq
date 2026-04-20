/**
 * 30-day revenue trend — total paid revenue per day with AI-attributed overlay.
 *
 * AI-attributed = sum(outbound_messages.actual_revenue_cents) bucketed by converted_at::date.
 * Total = sum(orders.total_cents WHERE status='paid') bucketed by paid_at::date.
 *
 * Renders as stacked area: total (muted) + AI on top (primary), so the
 * owner sees instantly what slice of revenue the autonomous system delivered.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAnalyticsWindow } from "./AnalyticsWindow";

type Props = { tenantId: string };

type Order = { total_cents: number; paid_at: string | null };
type Outbound = { actual_revenue_cents: number | null; converted_at: string | null };

function dayKey(iso: string) {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function fmtUsd(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function shortDate(key: string) {
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RevenueTrendChart({ tenantId }: Props) {
  const { days, sinceIso } = useAnalyticsWindow();
  const { data, isLoading } = useQuery({
    queryKey: ["revenue-trend", tenantId, days],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [ordersRes, outboundRes] = await Promise.all([
        supabase
          .from("orders")
          .select("total_cents, paid_at")
          .eq("tenant_id", tenantId)
          .eq("status", "paid")
          .gte("paid_at", sinceIso),
        supabase
          .from("outbound_messages")
          .select("actual_revenue_cents, converted_at")
          .eq("tenant_id", tenantId)
          .gte("converted_at", sinceIso),
      ]);
      return {
        orders: (ordersRes.data ?? []) as Order[],
        outbound: (outboundRes.data ?? []) as Outbound[],
      };
    },
  });

  const series = useMemo(() => {
    const buckets = new Map<string, { day: string; total: number; ai: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString();
      const k = dayKey(d);
      buckets.set(k, { day: k, total: 0, ai: 0 });
    }
    for (const o of data?.orders ?? []) {
      if (!o.paid_at) continue;
      const k = dayKey(o.paid_at);
      const cur = buckets.get(k);
      if (cur) cur.total += o.total_cents;
    }
    for (const m of data?.outbound ?? []) {
      if (!m.converted_at) continue;
      const k = dayKey(m.converted_at);
      const cur = buckets.get(k);
      if (cur) cur.ai += m.actual_revenue_cents ?? 0;
    }
    return Array.from(buckets.values()).map((b) => ({
      day: b.day,
      label: shortDate(b.day),
      total: b.total / 100,
      ai: b.ai / 100,
      organic: Math.max(0, (b.total - b.ai) / 100),
    }));
  }, [data]);

  const totals = useMemo(() => {
    const total = series.reduce((s, p) => s + p.total, 0);
    const ai = series.reduce((s, p) => s + p.ai, 0);
    const share = total > 0 ? Math.round((ai / total) * 100) : 0;
    return { total: total * 100, ai: ai * 100, share };
  }, [series]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-primary" />
          Revenue trend (30 days)
        </CardTitle>
        <CardDescription className="text-xs">
          Total <span className="font-semibold text-foreground">{fmtUsd(totals.total)}</span> · AI-attributed <span className="font-semibold text-primary">{fmtUsd(totals.ai)}</span> ({totals.share}%)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[220px] animate-pulse rounded-md bg-muted/30" />
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="organicGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="aiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v}`}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name) => [
                    `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    name === "ai" ? "AI-attributed" : name === "organic" ? "Organic" : name,
                  ]}
                  labelFormatter={(l) => `${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="organic"
                  stackId="1"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={1.5}
                  fill="url(#organicGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="ai"
                  stackId="1"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#aiGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
