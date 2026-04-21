/**
 * Cockpit hero — at-a-glance KPI strip with sparklines and pulse indicators.
 * Renders the 4 most critical numbers a brand owner cares about, with
 * cockpit-style glow accents and live deltas.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowUpRight, BadgeDollarSign, Bot, Sparkles, Users } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

type Props = { tenantId: string };

type Order = { total_cents: number; paid_at: string | null; created_at: string };
type Outbound = { actual_revenue_cents: number | null; converted_at: string | null; sent_at: string | null };

function fmtUsd(cents: number) {
  if (cents >= 1_000_000) return `$${(cents / 100_000).toFixed(1)}k`;
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function CockpitHero({ tenantId }: Props) {
  const { t } = useT();
  const { data, isLoading } = useQuery({
    queryKey: ["cockpit-hero", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [orders, outbound, customers, runs] = await Promise.all([
        supabase
          .from("orders")
          .select("total_cents, paid_at, created_at")
          .eq("tenant_id", tenantId)
          .eq("status", "paid")
          .gte("paid_at", since30),
        supabase
          .from("outbound_messages")
          .select("actual_revenue_cents, converted_at, sent_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", since30),
        supabase
          .from("customers")
          .select("id, lifecycle_stage")
          .eq("tenant_id", tenantId),
        supabase
          .from("acos_agent_runs")
          .select("status, started_at")
          .eq("tenant_id", tenantId)
          .gte("started_at", since30),
      ]);
      return {
        orders: (orders.data ?? []) as Order[],
        outbound: (outbound.data ?? []) as Outbound[],
        customers: customers.data ?? [],
        runs: runs.data ?? [],
      };
    },
  });

  const computed = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const buckets = new Map<string, { day: string; revenue: number; ai: number; runs: number }>();
    for (let i = 29; i >= 0; i--) {
      const iso = new Date(now - i * day).toISOString();
      buckets.set(dayKey(iso), { day: dayKey(iso), revenue: 0, ai: 0, runs: 0 });
    }
    let rev30 = 0;
    let rev7 = 0;
    let revPrev7 = 0;
    for (const o of data.orders) {
      if (!o.paid_at) continue;
      const ts = new Date(o.paid_at).getTime();
      const k = dayKey(o.paid_at);
      const b = buckets.get(k);
      if (b) b.revenue += o.total_cents;
      rev30 += o.total_cents;
      if (ts >= now - 7 * day) rev7 += o.total_cents;
      else if (ts >= now - 14 * day) revPrev7 += o.total_cents;
    }
    let ai30 = 0;
    let ai7 = 0;
    for (const m of data.outbound) {
      if (!m.converted_at) continue;
      const ts = new Date(m.converted_at).getTime();
      const k = dayKey(m.converted_at);
      const b = buckets.get(k);
      const c = m.actual_revenue_cents ?? 0;
      if (b) b.ai += c;
      ai30 += c;
      if (ts >= now - 7 * day) ai7 += c;
    }
    for (const r of data.runs) {
      const k = dayKey(r.started_at);
      const b = buckets.get(k);
      if (b) b.runs++;
    }
    const series = Array.from(buckets.values());
    const revDelta = revPrev7 > 0 ? Math.round(((rev7 - revPrev7) / revPrev7) * 100) : rev7 > 0 ? 100 : 0;
    const aiShare = rev30 > 0 ? Math.round((ai30 / rev30) * 100) : 0;
    const sent7 = data.outbound.filter((m) => m.sent_at && new Date(m.sent_at).getTime() >= now - 7 * day).length;
    const conv7 = data.outbound.filter((m) => m.converted_at && new Date(m.converted_at).getTime() >= now - 7 * day).length;
    const convRate = sent7 > 0 ? ((conv7 / sent7) * 100).toFixed(1) : "0.0";
    const totalCustomers = data.customers.length;
    const activeCustomers = data.customers.filter((c) => c.lifecycle_stage === "active" || c.lifecycle_stage === "vip").length;
    const successRuns = data.runs.filter((r) => r.status === "success").length;
    const totalRuns = data.runs.length;
    const agentHealth = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100;
    return {
      series,
      rev30,
      rev7,
      revDelta,
      ai30,
      ai7,
      aiShare,
      convRate,
      sent7,
      conv7,
      totalCustomers,
      activeCustomers,
      agentHealth,
      totalRuns,
    };
  }, [data]);

  if (isLoading || !computed) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse"><CardContent className="h-32" /></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <HeroCard
        icon={BadgeDollarSign}
        label={t("hero.revenue30")}
        value={fmtUsd(computed.rev30)}
        sub={`${fmtUsd(computed.rev7)} ${t("hero.thisWeek")}`}
        delta={computed.revDelta}
        series={computed.series}
        seriesKey="revenue"
        tone="default"
      />
      <HeroCard
        icon={Sparkles}
        label={t("hero.aiAttributed")}
        value={fmtUsd(computed.ai30)}
        sub={`${computed.aiShare}% ${t("hero.ofRevenue")} · ${fmtUsd(computed.ai7)} ${t("hero.7d")}`}
        series={computed.series}
        seriesKey="ai"
        tone="primary"
        badge={t("hero.autonomous")}
      />
      <HeroCard
        icon={Bot}
        label={t("hero.conversion7")}
        value={`${computed.convRate}%`}
        sub={`${computed.conv7} ${t("hero.converted")} ${computed.sent7}`}
        series={computed.series}
        seriesKey="ai"
        tone="accent"
      />
      <HeroCard
        icon={Users}
        label={t("hero.customers")}
        value={computed.totalCustomers.toLocaleString()}
        sub={`${computed.activeCustomers} ${t("hero.active")} ${computed.agentHealth}%`}
        series={computed.series}
        seriesKey="runs"
        tone={computed.agentHealth >= 90 ? "success" : computed.agentHealth >= 70 ? "warning" : "destructive"}
      />
    </div>
  );
}

type HeroCardProps = {
  icon: typeof BadgeDollarSign;
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  series: Array<{ day: string; revenue: number; ai: number; runs: number }>;
  seriesKey: "revenue" | "ai" | "runs";
  tone: "default" | "primary" | "accent" | "success" | "warning" | "destructive";
  badge?: string;
};

const TONE: Record<HeroCardProps["tone"], { ring: string; glow: string; gradId: string; stroke: string; fill: string; iconCls: string }> = {
  default:    { ring: "border-border",                 glow: "",                                    gradId: "spark-default",  stroke: "hsl(var(--muted-foreground))", fill: "hsl(var(--muted-foreground))", iconCls: "text-muted-foreground" },
  primary:    { ring: "border-primary/40",             glow: "shadow-[0_0_30px_-12px_hsl(var(--primary)/0.4)]", gradId: "spark-primary",  stroke: "hsl(var(--primary))",          fill: "hsl(var(--primary))",          iconCls: "text-primary" },
  accent:     { ring: "border-accent/40",              glow: "shadow-[0_0_30px_-12px_hsl(var(--accent)/0.4)]",  gradId: "spark-accent",   stroke: "hsl(var(--accent))",           fill: "hsl(var(--accent))",           iconCls: "text-accent" },
  success:    { ring: "border-success/40",             glow: "shadow-[0_0_30px_-12px_hsl(var(--success)/0.4)]", gradId: "spark-success",  stroke: "hsl(var(--success))",          fill: "hsl(var(--success))",          iconCls: "text-success" },
  warning:    { ring: "border-warning/40",             glow: "",                                    gradId: "spark-warning",  stroke: "hsl(var(--warning))",          fill: "hsl(var(--warning))",          iconCls: "text-warning-foreground" },
  destructive:{ ring: "border-destructive/40",         glow: "shadow-[0_0_30px_-12px_hsl(var(--destructive)/0.4)]", gradId: "spark-destructive", stroke: "hsl(var(--destructive))",  fill: "hsl(var(--destructive))",      iconCls: "text-destructive" },
};

function HeroCard({ icon: Icon, label, value, sub, delta, series, seriesKey, tone, badge }: HeroCardProps) {
  const t = TONE[tone];
  return (
    <Card className={`relative overflow-hidden ${t.ring} ${t.glow}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${t.iconCls}`} />
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
          {typeof delta === "number" && (
            <Badge variant="outline" className={`text-[10px] ${delta >= 0 ? "text-success border-success/40" : "text-destructive border-destructive/40"}`}>
              {delta >= 0 ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
              {Math.abs(delta)}%
            </Badge>
          )}
          {badge && !delta && (
            <Badge variant="outline" className={`text-[9px] ${t.iconCls} ${t.ring}`}>
              <Activity className="mr-0.5 h-2.5 w-2.5 animate-pulse" />
              {badge}
            </Badge>
          )}
        </div>
        {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
        <div className="mt-3 h-10 -mx-1 -mb-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={t.gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.fill} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={t.fill} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey={seriesKey}
                stroke={t.stroke}
                strokeWidth={1.5}
                fill={`url(#${t.gradId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
