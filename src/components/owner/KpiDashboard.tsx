/**
 * Owner KPI dashboard — top-of-page summary cards.
 * Window-aware (7d / 30d / 90d) via AnalyticsWindowProvider.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  BadgeDollarSign,
  Bot,
  ShoppingBag,
  Sparkles,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAnalyticsWindow } from "./AnalyticsWindow";
import { formatMoney } from "@/lib/money";
import { DetailableElement, type DetailPayload } from "@/components/detail";

type Props = { tenantId: string };

type Outbound = {
  trigger_kind: string;
  status: string;
  actual_revenue_cents: number | null;
  sent_at: string | null;
  converted_at: string | null;
};
type Order = { total_cents: number; paid_at: string | null };
type Customer = {
  lifecycle_stage: string;
  last_order_at: string | null;
  predicted_next_order_at: string | null;
};

const TRIGGER_LABEL: Record<string, string> = {
  reorder: "Повторне замовлення",
  winback: "Повернення клієнта",
  abandoned_cart: "Покинутий кошик",
  promo: "Промо-нагадування",
  sales_reply: "Відповідь продавця",
};

function within(dateIso: string | null, sinceMs: number) {
  if (!dateIso) return false;
  return new Date(dateIso).getTime() >= sinceMs;
}

export function KpiDashboard({ tenantId }: Props) {
  const { days, sinceMs, sinceIso } = useAnalyticsWindow();
  const compareDays = Math.max(1, Math.floor(days / 4)); // shorter sub-window for context
  const compareSinceMs = Date.now() - compareDays * 24 * 3600 * 1000;

  const { data, isLoading } = useQuery({
    queryKey: ["kpi-dashboard", tenantId, days],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [ordersRes, outboundRes, customersRes] = await Promise.all([
        supabase
          .from("orders")
          .select("total_cents, paid_at")
          .eq("tenant_id", tenantId)
          .eq("status", "paid")
          .gte("paid_at", sinceIso),
        supabase
          .from("outbound_messages")
          .select("trigger_kind, status, actual_revenue_cents, sent_at, converted_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", sinceIso),
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
          <Card key={i} className="animate-pulse">
            <CardContent className="h-24" />
          </Card>
        ))}
      </div>
    );
  }

  const now = Date.now();

  const revenueWin = data.orders
    .filter((o) => within(o.paid_at, sinceMs))
    .reduce((s, o) => s + o.total_cents, 0);
  const revenueCmp = data.orders
    .filter((o) => within(o.paid_at, compareSinceMs))
    .reduce((s, o) => s + o.total_cents, 0);
  const ordersWin = data.orders.filter((o) => within(o.paid_at, sinceMs)).length;
  const ordersCmp = data.orders.filter((o) => within(o.paid_at, compareSinceMs)).length;
  const aovWin = ordersWin > 0 ? revenueWin / ordersWin : 0;

  const aiRevWin = data.outbound
    .filter((m) => within(m.converted_at, sinceMs))
    .reduce((s, m) => s + (m.actual_revenue_cents ?? 0), 0);
  const aiRevCmp = data.outbound
    .filter((m) => within(m.converted_at, compareSinceMs))
    .reduce((s, m) => s + (m.actual_revenue_cents ?? 0), 0);
  const aiShareWin = revenueWin > 0 ? Math.round((aiRevWin / revenueWin) * 100) : 0;

  const byTrigger = new Map<string, { sent: number; converted: number; revenue: number }>();
  for (const m of data.outbound) {
    const t = m.trigger_kind || "other";
    const cur = byTrigger.get(t) ?? { sent: 0, converted: 0, revenue: 0 };
    if (m.sent_at && within(m.sent_at, sinceMs)) cur.sent++;
    if (m.converted_at && within(m.converted_at, sinceMs)) {
      cur.converted++;
      cur.revenue += m.actual_revenue_cents ?? 0;
    }
    byTrigger.set(t, cur);
  }
  const triggerRows = Array.from(byTrigger.entries())
    .filter(([, v]) => v.sent > 0 || v.converted > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue);

  const totalCustomers = data.customers.length;
  const activeCustomers = data.customers.filter(
    (c) => c.lifecycle_stage === "active" || c.lifecycle_stage === "vip",
  ).length;
  const overdue = data.customers.filter(
    (c) => c.predicted_next_order_at && new Date(c.predicted_next_order_at).getTime() < now,
  ).length;

  const sentWin = data.outbound.filter((m) => m.sent_at && within(m.sent_at, sinceMs)).length;
  const convWin = data.outbound.filter(
    (m) => m.converted_at && within(m.converted_at, sinceMs),
  ).length;
  const convRate = sentWin > 0 ? ((convWin / sentWin) * 100).toFixed(1) : "0.0";

  const winLabel = `${days}д`;
  const cmpLabel = `${compareDays}д`;

  // ---- Build daily timeseries for the window (revenue & ai-revenue) ----
  const dayBuckets: { day: string; revenue: number; aiRevenue: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 3600 * 1000);
    d.setHours(0, 0, 0, 0);
    dayBuckets.push({
      day: d.toISOString().slice(0, 10),
      revenue: 0,
      aiRevenue: 0,
      orders: 0,
    });
  }
  const idxOf = (iso: string | null) => {
    if (!iso) return -1;
    const dayIso = new Date(iso).toISOString().slice(0, 10);
    return dayBuckets.findIndex((b) => b.day === dayIso);
  };
  for (const o of data.orders) {
    const i = idxOf(o.paid_at);
    if (i >= 0) {
      dayBuckets[i].revenue += o.total_cents;
      dayBuckets[i].orders += 1;
    }
  }
  for (const m of data.outbound) {
    const i = idxOf(m.converted_at);
    if (i >= 0) dayBuckets[i].aiRevenue += m.actual_revenue_cents ?? 0;
  }

  const fmtDay = (d: string) =>
    new Date(d).toLocaleDateString("uk-UA", { day: "2-digit", month: "short" });

  // ---- Detail payload builders (eager, reuse already-fetched data) ----
  const revenueDetail: DetailPayload = {
    title: `Виторг за ${winLabel}`,
    subtitle: `${formatMoney(revenueWin)} · ${ordersWin} замовлень`,
    status: {
      label: revenueWin > revenueCmp * 4 ? "Зростає" : "Стабільно",
      tone: revenueWin >= revenueCmp * 4 ? "success" : "default",
    },
    metrics: [
      { label: "Виторг", value: formatMoney(revenueWin), tone: "primary" },
      { label: "Замовлень", value: ordersWin.toLocaleString("uk-UA") },
      { label: "Середній чек", value: formatMoney(aovWin) },
      {
        label: `Попередні ${cmpLabel}`,
        value: formatMoney(revenueCmp),
        hint: `${ordersCmp} замовлень`,
      },
      {
        label: "Доля ШІ",
        value: `${aiShareWin}%`,
        hint: formatMoney(aiRevWin),
        tone: aiShareWin > 0 ? "success" : "default",
      },
      { label: "Конверсія розсилок", value: `${convRate}%`, hint: `${convWin}/${sentWin}` },
    ],
    timeseries: dayBuckets.map((b) => ({ t: fmtDay(b.day), v: Math.round(b.revenue / 100) })),
    description:
      ordersWin === 0
        ? "За обраний період не зафіксовано оплачених замовлень. Перевірте трекінг або інтеграцію оплат."
        : `За ${winLabel} магазин отримав ${formatMoney(revenueWin)} виторгу з ${ordersWin} замовлень. ШІ-агенти атрибутували ${formatMoney(aiRevWin)} (${aiShareWin}%).`,
    metadata: {
      Період: `${days} днів`,
      "Підвікно для порівняння": `${compareDays} днів`,
      "Замовлень / день (середнє)": (ordersWin / Math.max(1, days)).toFixed(2),
    },
  };

  const aiRevenueDetail: DetailPayload = {
    title: `Виторг від ШІ-агентів за ${winLabel}`,
    subtitle: `${formatMoney(aiRevWin)} · ${aiShareWin}% від загального`,
    status: {
      label: convWin > 0 ? "Активно" : "Очікує",
      tone: convWin > 0 ? "success" : "default",
    },
    metrics: [
      { label: "Зароблено ШІ", value: formatMoney(aiRevWin), tone: "primary" },
      { label: "Доля від виторгу", value: `${aiShareWin}%` },
      { label: "Куплено після розсилки", value: convWin.toLocaleString("uk-UA") },
      { label: "Надіслано", value: sentWin.toLocaleString("uk-UA") },
      {
        label: "Конверсія",
        value: `${convRate}%`,
        tone: Number(convRate) > 5 ? "success" : "default",
      },
      { label: `Попередні ${cmpLabel}`, value: formatMoney(aiRevCmp) },
    ],
    timeseries: dayBuckets.map((b) => ({ t: fmtDay(b.day), v: Math.round(b.aiRevenue / 100) })),
    description:
      triggerRows.length === 0
        ? "Поки що ШІ-агенти не згенерували атрибутованого виторгу. Перевірте, чи активовано рушії розсилок."
        : `Найкращий тригер: ${TRIGGER_LABEL[triggerRows[0][0]] ?? triggerRows[0][0]} — ${formatMoney(triggerRows[0][1].revenue)}.`,
    related_items: triggerRows.slice(0, 6).map(([kind, v]) => ({
      id: kind,
      resourceType: "metric",
      title: TRIGGER_LABEL[kind] ?? kind,
      subtitle: `${v.converted}/${v.sent} · ${formatMoney(v.revenue)}`,
      badge: v.sent > 0 ? `${((v.converted / v.sent) * 100).toFixed(0)}%` : undefined,
    })),
  };

  const aovDetail: DetailPayload = {
    title: `Середній чек (${winLabel})`,
    subtitle: formatMoney(aovWin),
    metrics: [
      { label: "Середній чек", value: formatMoney(aovWin), tone: "primary" },
      { label: "Замовлень", value: ordersWin.toLocaleString("uk-UA") },
      { label: "Виторг", value: formatMoney(revenueWin) },
      { label: `Замовлень за ${cmpLabel}`, value: ordersCmp.toLocaleString("uk-UA") },
    ],
    timeseries: dayBuckets.map((b) => ({
      t: fmtDay(b.day),
      v: b.orders > 0 ? Math.round(b.revenue / b.orders / 100) : 0,
    })),
    description:
      "Середній чек = виторг ÷ кількість оплачених замовлень. Зростання вказує на ефективність upsell- та bundle-агентів.",
  };

  const customersDetail: DetailPayload = {
    title: "Клієнтська база",
    subtitle: `${totalCustomers.toLocaleString("uk-UA")} покупців`,
    status:
      overdue > 0
        ? { label: `${overdue} прострочених`, tone: "warning" }
        : { label: "Без термінових", tone: "success" },
    metrics: [
      { label: "Усього", value: totalCustomers.toLocaleString("uk-UA") },
      { label: "Активні / VIP", value: activeCustomers.toLocaleString("uk-UA"), tone: "success" },
      {
        label: "Прострочені",
        value: overdue.toLocaleString("uk-UA"),
        tone: overdue > 0 ? "warning" : "default",
      },
      {
        label: "Сплячі",
        value: data.customers
          .filter((c) => c.lifecycle_stage === "dormant")
          .length.toLocaleString("uk-UA"),
      },
      {
        label: "Нові",
        value: data.customers
          .filter((c) => c.lifecycle_stage === "new")
          .length.toLocaleString("uk-UA"),
      },
      {
        label: "Ризик відтоку",
        value: data.customers
          .filter((c) => c.lifecycle_stage === "at_risk")
          .length.toLocaleString("uk-UA"),
        tone: "destructive",
      },
    ],
    description:
      overdue > 0
        ? `${overdue} клієнтів вже мали б купити повторно — час запустити reorder-агента.`
        : "Усі клієнти в межах прогнозу повторної покупки.",
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailableElement
          elementId="revenue"
          resourceType="kpi"
          drawerTitle={`Виторг за ${winLabel}`}
          drawerSize="md"
          payload={revenueDetail}
          ariaLabel="Деталі виторгу"
        >
          <KpiCard
            icon={BadgeDollarSign}
            label={`Виторг (${winLabel})`}
            value={formatMoney(revenueWin)}
            sub={`${formatMoney(revenueCmp)} попередні ${cmpLabel} · ${ordersWin} замовл.`}
          />
        </DetailableElement>
        <DetailableElement
          elementId="ai-revenue"
          resourceType="kpi"
          drawerTitle="Виторг від ШІ"
          drawerSize="md"
          payload={aiRevenueDetail}
          ariaLabel="Деталі виторгу від ШІ"
        >
          <KpiCard
            icon={Sparkles}
            label={`Від ШІ (${winLabel})`}
            value={formatMoney(aiRevWin)}
            sub={`${formatMoney(aiRevCmp)} попередні ${cmpLabel} · ${aiShareWin}% усього`}
            accent="primary"
          />
        </DetailableElement>
        <DetailableElement
          elementId="aov"
          resourceType="kpi"
          drawerTitle="Середній чек"
          drawerSize="md"
          payload={aovDetail}
          ariaLabel="Деталі середнього чеку"
        >
          <KpiCard
            icon={ShoppingBag}
            label={`Середній чек (${winLabel})`}
            value={formatMoney(aovWin)}
            sub={`${ordersCmp} замовлень за ${cmpLabel}`}
          />
        </DetailableElement>
        <DetailableElement
          elementId="customers"
          resourceType="kpi"
          drawerTitle="Клієнтська база"
          drawerSize="md"
          payload={customersDetail}
          ariaLabel="Деталі клієнтської бази"
        >
          <KpiCard
            icon={Users}
            label="Клієнти"
            value={totalCustomers.toLocaleString("uk-UA")}
            sub={`${activeCustomers} активні · ${overdue} прострочені`}
          />
        </DetailableElement>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-primary" />
            Що заробили агенти (останні {winLabel})
          </CardTitle>
          <CardDescription className="text-xs">
            Атрибуція по тригеру. Загальна конверсія:{" "}
            <span className="font-semibold text-foreground">{convRate}%</span> ({convWin} з{" "}
            {sentWin} надісланих).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {triggerRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              <Activity className="mx-auto mb-2 h-5 w-5" />
              Поки що відправок немає. Запустіть рушій нижче або зачекайте на наступний цикл cron.
            </div>
          ) : (
            <div className="space-y-2">
              {triggerRows.map(([kind, v]) => {
                const rate = v.sent > 0 ? ((v.converted / v.sent) * 100).toFixed(1) : "0.0";
                const triggerDetail: DetailPayload = {
                  title: TRIGGER_LABEL[kind] ?? kind,
                  subtitle: `${formatMoney(v.revenue)} за ${winLabel}`,
                  status: {
                    label: v.converted > 0 ? "Працює" : "Без конверсій",
                    tone: v.converted > 0 ? "success" : "warning",
                  },
                  metrics: [
                    { label: "Виторг", value: formatMoney(v.revenue), tone: "primary" },
                    { label: "Надіслано", value: v.sent.toLocaleString("uk-UA") },
                    {
                      label: "Куплено",
                      value: v.converted.toLocaleString("uk-UA"),
                      tone: "success",
                    },
                    { label: "Конверсія", value: `${rate}%` },
                  ],
                  description: `Тригер «${TRIGGER_LABEL[kind] ?? kind}» згенерував ${formatMoney(v.revenue)} з ${v.sent} надісланих повідомлень.`,
                  metadata: { "Ключ тригера": kind, Період: `${days} днів` },
                };
                return (
                  <DetailableElement
                    key={kind}
                    elementId={`trigger:${kind}`}
                    resourceType="metric"
                    drawerTitle={TRIGGER_LABEL[kind] ?? kind}
                    drawerSize="md"
                    payload={triggerDetail}
                    ariaLabel={`Деталі тригера ${TRIGGER_LABEL[kind] ?? kind}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {TRIGGER_LABEL[kind] ?? kind}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {v.sent} надіслано · {v.converted} куплено · {rate}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-semibold text-primary">
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        {formatMoney(v.revenue)}
                      </div>
                    </div>
                  </DetailableElement>
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
  icon: Icon,
  label,
  value,
  sub,
  accent,
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
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <Icon
            className={`h-4 w-4 ${accent === "primary" ? "text-primary" : "text-muted-foreground"}`}
          />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
