/**
 * Realtime Revenue Pulse — live 24h sparkline tile.
 * Subscribes to orders INSERT/UPDATE via Supabase Realtime so a paid order
 * appears in the chart within ~1s. Pulse glow on every new event.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Zap } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, HRYVNIA, formatNumber } from "@/lib/money";
import { CHART } from "@/lib/chartColors";

type Props = { tenantId: string };

type OrderRow = {
  id: string;
  total_cents: number;
  paid_at: string | null;
  status: string;
};

function hourKey(iso: string) {
  return iso.slice(0, 13); // YYYY-MM-DDTHH
}

function shortHour(key: string) {
  const d = new Date(key + ":00:00Z");
  return d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

export function RealtimeRevenuePulse({ tenantId }: Props) {
  const [pulseAt, setPulseAt] = useState<number>(0);
  const [liveDelta, setLiveDelta] = useState<{ cents: number; count: number }>({
    cents: 0,
    count: 0,
  });

  const since = useMemo(() => new Date(Date.now() - 24 * 3600 * 1000).toISOString(), []);

  const { data, refetch } = useQuery({
    queryKey: ["realtime-pulse", tenantId, since],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, total_cents, paid_at, status")
        .eq("tenant_id", tenantId)
        .eq("status", "paid")
        .gte("paid_at", since)
        .order("paid_at", { ascending: true });
      return (data ?? []) as OrderRow[];
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`pulse-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as Partial<OrderRow> | null;
          if (!row) return;
          if (row.status === "paid" && row.paid_at) {
            setPulseAt(Date.now());
            setLiveDelta((d) => ({
              cents: d.cents + (row.total_cents ?? 0),
              count: d.count + 1,
            }));
            void refetch();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, refetch]);

  // Reset pulse glow after 1.5s
  useEffect(() => {
    if (!pulseAt) return;
    const t = setTimeout(() => setPulseAt(0), 1500);
    return () => clearTimeout(t);
  }, [pulseAt]);

  const series = useMemo(() => {
    const buckets = new Map<string, { hour: string; revenue: number; count: number }>();
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000).toISOString();
      const k = hourKey(d);
      buckets.set(k, { hour: k, revenue: 0, count: 0 });
    }
    for (const o of data ?? []) {
      if (!o.paid_at) continue;
      const k = hourKey(o.paid_at);
      const b = buckets.get(k);
      if (b) {
        b.revenue += o.total_cents / 100;
        b.count += 1;
      }
    }
    return Array.from(buckets.values()).map((b) => ({
      ...b,
      label: shortHour(b.hour),
    }));
  }, [data]);

  const totals = useMemo(() => {
    const cents = (data ?? []).reduce((s, o) => s + o.total_cents, 0);
    const count = data?.length ?? 0;
    return { cents, count };
  }, [data]);

  const isLive = Date.now() - pulseAt < 1500;

  return (
    <Card
      className={`relative overflow-hidden transition-shadow ${
        isLive
          ? "shadow-[0_0_40px_-8px_color-mix(in_oklab,var(--primary)_60%,transparent)] border-primary/60"
          : "border-border"
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap
              className={`h-4 w-4 ${isLive ? "text-primary animate-pulse" : "text-muted-foreground"}`}
            />
            Live Revenue Pulse · 24h
          </CardTitle>
          <Badge
            variant="outline"
            className="text-[10px] border-primary/40 text-primary"
          >
            <Activity className="mr-1 h-2.5 w-2.5 animate-pulse" />
            REALTIME
          </Badge>
        </div>
        <CardDescription className="text-xs">
          <span className="font-semibold text-foreground">{formatMoney(totals.cents)}</span> ·{" "}
          {totals.count} замовлень за добу
          {liveDelta.count > 0 && (
            <span className="ml-2 text-primary">
              +{liveDelta.count} (+{formatMoney(liveDelta.cents)}) щойно
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[140px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="pulseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.7} />
                  <stop offset="100%" stopColor={CHART.primary} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={CHART.tickStyle}
                tickLine={false}
                axisLine={false}
                interval={3}
              />
              <YAxis
                tick={CHART.tickStyle}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${formatNumber(Number(v))}`}
                width={48}
              />
              <Tooltip
                contentStyle={CHART.tooltipStyle}
                cursor={{ fill: CHART.cursorFill }}
                formatter={(v: number, name) =>
                  name === "revenue"
                    ? [`${formatNumber(v)} ${HRYVNIA}`, "Виторг"]
                    : [v, "Замовлення"]
                }
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={CHART.primary}
                strokeWidth={2}
                fill="url(#pulseGrad)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
