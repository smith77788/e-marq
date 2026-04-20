/**
 * Owner KPI dashboard — top-of-page summary cards.
 *
 * Pulls last 30d of:
 *   - paid orders  → total revenue, AOV, order count
 *   - outbound_messages with actual_revenue_cents → AI-attributed revenue per trigger_kind
 *   - customers → active count + at-risk count
 *
 * Two windows side by side: "Last 7d" vs "Last 30d" so trends are visible.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowUpRight, BadgeDollarSign, Bot, ShoppingBag, Sparkles, Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type Outbound = {
  trigger_kind: string;
  status: string;
  actual_revenue_cents: number | null;
  sent_at: string | null;
  converted_at: string | null;
};
type Order = { total_cents: number; paid_at: string | null };
type Customer = { lifecycle_stage: string; last_order_at: string | null; predicted_next_order_at: string | null };

const TRIGGER_LABEL: Record<string, string> = {
  reorder: "Reorder",
  winback: "Winback",
  abandoned_cart: "Cart recovery",
  promo: "Promo nudge",
  sales_reply: "Sales reply",
};

function fmtUsd(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function within(dateIso: string | null, sinceMs: number) {
  if (!dateIso) return false;
  return new Date(dateIso).getTime() >= sinceMs;
}

export function KpiDashboard({ tenantId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["kpi-dashboard", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [ordersRes, outboundRes, customersRes] = await Promise.all([
        supabase
          .from("orders")
          .select("total_cents, paid_at")
          .eq("tenant_id", tenantId)
          .eq("status", "paid")
          .gte("paid_at", since30),
        supabase
          .from("outbound_messages")
          .select("trigger_kind, status, actual_revenue_cents, sent_at, converted_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", since30),
        supabase
          .from("customers")
          .select("lifecycle_stage, last_order_at, predicted_next_order_at")
          .eq("tenant_id", tenantId),
      ]);
      return {
        orders: (ordersRes.data ?? []) as Order[],
        outbound: (outboundRes.data ?? []) as Outbound[],
        customers: (customersRes.data ?? []) as Customer[],
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse"><CardContent className="h-24" /></Card>
        ))}
      </div>
    );
  }

  const now = Date.now();
  const ms7 = now - 7 * 24 * 3600 * 1000;
  const ms30 = now - 30 * 24 * 3600 * 1000;

  // Revenue
  const revenue7 = data.orders.filter((o) => within(o.paid_at, ms7)).reduce((s, o) => s + o.total_cents, 0);
  const revenue30 = data.orders.filter((o) => within(o.paid_at, ms30)).reduce((s, o) => s + o.total_cents, 0);
  const orders7 = data.orders.filter((o) => within(o.paid_at, ms7)).length;
  const orders30 = data.orders.filter((o) => within(o.paid_at, ms30)).length;
  const aov30 = orders30 > 0 ? revenue30 / orders30 : 0;

  // AI attribution: revenue from outbound where conversion happened
  const aiRev7 = data.outbound
    .filter((m) => within(m.converted_at, ms7))
    .reduce((s, m) => s + (m.actual_revenue_cents ?? 0), 0);
  const aiRev30 = data.outbound
    .filter((m) => within(m.converted_at, ms30))
    .reduce((s, m) => s + (m.actual_revenue_cents ?? 0), 0);
  const aiShare30 = revenue30 > 0 ? Math.round((aiRev30 / revenue30) * 100) : 0;

  // Per-trigger breakdown (30d)
  const byTrigger = new Map<string, { sent: number; converted: number; revenue: number }>();
  for (const m of data.outbound) {
    const t = m.trigger_kind || "other";
    const cur = byTrigger.get(t) ?? { sent: 0, converted: 0, revenue: 0 };
    if (m.sent_at && within(m.sent_at, ms30)) cur.sent++;
    if (m.converted_at && within(m.converted_at, ms30)) {
      cur.converted++;
      cur.revenue += m.actual_revenue_cents ?? 0;
    }
    byTrigger.set(t, cur);
  }
  const triggerRows = Array.from(byTrigger.entries())
    .filter(([, v]) => v.sent > 0 || v.converted > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue);

  // Customers
  const totalCustomers = data.customers.length;
  const activeCustomers = data.customers.filter((c) => c.lifecycle_stage === "active" || c.lifecycle_stage === "vip").length;
  const overdue = data.customers.filter(
    (c) => c.predicted_next_order_at && new Date(c.predicted_next_order_at).getTime() < now,
  ).length;

  // Conversion rate
  const sent30 = data.outbound.filter((m) => m.sent_at && within(m.sent_at, ms30)).length;
  const conv30 = data.outbound.filter((m) => m.converted_at && within(m.converted_at, ms30)).length;
  const convRate = sent30 > 0 ? ((conv30 / sent30) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={BadgeDollarSign}
          label="Revenue (30d)"
          value={fmtUsd(revenue30)}
          sub={`${fmtUsd(revenue7)} last 7d · ${orders30} orders`}
        />
        <KpiCard
          icon={Sparkles}
          label="AI-attributed (30d)"
          value={fmtUsd(aiRev30)}
          sub={`${fmtUsd(aiRev7)} last 7d · ${aiShare30}% of total`}
          accent="primary"
        />
        <KpiCard
          icon={ShoppingBag}
          label="AOV (30d)"
          value={fmtUsd(aov30)}
          sub={`${orders7} orders last 7d`}
        />
        <KpiCard
          icon={Users}
          label="Customers"
          value={totalCustomers.toLocaleString()}
          sub={`${activeCustomers} active · ${overdue} overdue`}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-primary" />
            What the agents earned (last 30 days)
          </CardTitle>
          <CardDescription className="text-xs">
            Attribution per trigger. Conversion rate overall: <span className="font-semibold text-foreground">{convRate}%</span> ({conv30} of {sent30} sent).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {triggerRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              <Activity className="mx-auto mb-2 h-5 w-5" />
              No outbound activity yet. Trigger an engine below or wait for the next cron tick.
            </div>
          ) : (
            <div className="space-y-2">
              {triggerRows.map(([kind, v]) => {
                const rate = v.sent > 0 ? ((v.converted / v.sent) * 100).toFixed(1) : "0.0";
                return (
                  <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{TRIGGER_LABEL[kind] ?? kind}</Badge>
                      <span className="text-xs text-muted-foreground">{v.sent} sent · {v.converted} converted · {rate}%</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm font-semibold text-primary">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      {fmtUsd(v.revenue)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof BadgeDollarSign;
  label: string;
  value: string;
  sub?: string;
  accent?: "primary";
}) {
  const accentCls = accent === "primary" ? "border-primary/40 bg-primary/5" : "";
  return (
    <Card className={accentCls}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${accent === "primary" ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
