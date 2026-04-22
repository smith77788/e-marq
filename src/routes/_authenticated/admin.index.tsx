/**
 * Mission Control — головний дашборд super-admin.
 * Структуровано в логічні секції з eyebrow-заголовками для чіткої ієрархії.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  Cpu,
  DollarSign,
  Lightbulb,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { MissionStatCard } from "@/components/admin/MissionStatCard";
import { TenantLeaderboard, type TenantLeaderRow } from "@/components/admin/TenantLeaderboard";
import { SystemHealthGrid } from "@/components/admin/SystemHealthGrid";
import { CrossTenantPulse } from "@/components/admin/CrossTenantPulse";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: MissionControlPage,
});

function MissionControlPage() {
  const { isSuperAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <MissionControlContent />;
}

/* -------------------------------------------------------------------------- */
/*  Header section                                                            */
/* -------------------------------------------------------------------------- */

function MissionHeader({ t }: { t: (k: never) => string }) {
  return (
    <header className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-card/60 to-accent/5 p-6 shadow-elegant backdrop-blur">
      <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <ShieldCheck className="h-4 w-4 text-primary-foreground" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-card animate-pulse" />
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
              {t("mc.title")}
            </p>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Командний центр
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t("mc.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/users">
              <Users className="mr-1.5 h-4 w-4" /> Користувачі
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/tenants">
              <Building2 className="mr-1.5 h-4 w-4" /> {t("sb.allTenants")}
            </Link>
          </Button>
          <Button asChild size="sm" className="shadow-glow">
            <Link to="/admin/commands">
              <Zap className="mr-1.5 h-4 w-4" /> Команди
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section header                                                            */
/* -------------------------------------------------------------------------- */

function SectionHeader({
  eyebrow,
  title,
  hint,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  icon?: typeof Activity;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-l-2 border-primary/40 pl-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary/80">
          {eyebrow}
        </p>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          {title}
        </h2>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main content                                                              */
/* -------------------------------------------------------------------------- */

function MissionControlContent() {
  const { t } = useT();
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const overview = useQuery({
    queryKey: ["mc-overview"],
    queryFn: async () => {
      const [tenants, orders, insights, runs, customers, actions] = await Promise.all([
        supabase.from("tenants").select("id, name, slug, status, created_at"),
        supabase
          .from("orders")
          .select("tenant_id, total_cents, status, created_at")
          .gte("created_at", sinceIso),
        supabase
          .from("ai_insights")
          .select("tenant_id, status, created_at, risk_level")
          .gte("created_at", sinceIso),
        supabase
          .from("acos_agent_runs")
          .select("tenant_id, agent_id, status, insights_created, started_at")
          .gte("started_at", since24hIso),
        supabase.from("customers").select("tenant_id, id"),
        supabase
          .from("ai_actions")
          .select("tenant_id, status, created_at")
          .gte("created_at", sinceIso),
      ]);
      return {
        tenants: tenants.data ?? [],
        orders: orders.data ?? [],
        insights: insights.data ?? [],
        runs: runs.data ?? [],
        customers: customers.data ?? [],
        actions: actions.data ?? [],
      };
    },
    refetchInterval: 60_000,
  });

  if (overview.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  const data = overview.data!;
  const totalRevenue = data.orders
    .filter((o) => o.status === "paid")
    .reduce((s, o) => s + (o.total_cents ?? 0), 0);
  const paidOrders = data.orders.filter((o) => o.status === "paid").length;
  const pendingInsights = data.insights.filter((i) => i.status === "pending").length;
  const highRiskInsights = data.insights.filter((i) => i.risk_level === "high").length;
  const failedRuns = data.runs.filter((r) => r.status === "failed").length;
  const successRuns = data.runs.filter((r) => r.status === "ok").length;
  const pendingActions = data.actions.filter((a) => a.status === "pending").length;
  const activeTenants = data.tenants.filter((t) => t.status === "active").length;

  // Build leaderboard
  const leaderRows: TenantLeaderRow[] = data.tenants
    .map((t) => {
      const tenantOrders = data.orders.filter((o) => o.tenant_id === t.id && o.status === "paid");
      const tenantInsights = data.insights.filter((i) => i.tenant_id === t.id);
      const tenantRuns = data.runs.filter((r) => r.tenant_id === t.id);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        revenueCents: tenantOrders.reduce((s, o) => s + (o.total_cents ?? 0), 0),
        orders: tenantOrders.length,
        insights: tenantInsights.length,
        agentRuns: tenantRuns.length,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10);

  // Build daily revenue points
  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const o of data.orders) {
    if (o.status !== "paid") continue;
    const day = (o.created_at as string).slice(0, 10);
    const cur = byDay.get(day) ?? { revenue: 0, orders: 0 };
    cur.revenue += o.total_cents ?? 0;
    cur.orders += 1;
    byDay.set(day, cur);
  }
  const points = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, ...v }));

  // Health grid
  const healthRows = Array.from(
    data.runs
      .reduce((acc, r) => {
        const cur = acc.get(r.agent_id) ?? {
          agent_id: r.agent_id,
          runs_total: 0,
          runs_failed: 0,
          insights_created: 0,
        };
        cur.runs_total += 1;
        if (r.status === "failed") cur.runs_failed += 1;
        cur.insights_created += r.insights_created ?? 0;
        acc.set(r.agent_id, cur);
        return acc;
      }, new Map<string, { agent_id: string; runs_total: number; runs_failed: number; insights_created: number }>())
      .values(),
  );

  // Health badges for top header
  const fleetHealthy = failedRuns === 0;
  const insightsLoad = pendingInsights + pendingActions;

  return (
    <div className="space-y-8">
      {/* HERO */}
      <MissionHeader t={t} />

      {/* SECTION 1 — пульс системи */}
      <section className="space-y-4">
        <SectionHeader
          eyebrow="01 · стан системи"
          title="Пульс мережі за 30 днів"
          hint="Оновлення кожну хвилину"
          icon={Activity}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MissionStatCard
            label={t("mc.activeTenants")}
            value={data.tenants.length}
            hint={`${activeTenants} активних`}
            icon={Building2}
            tone="primary"
          />
          <MissionStatCard
            label={t("mc.gmv30")}
            value={`${(totalRevenue / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`}
            hint={`${paidOrders} оплачено`}
            icon={DollarSign}
            tone="success"
          />
          <MissionStatCard
            label="Клієнтська база"
            value={data.customers.length.toLocaleString("uk-UA")}
            hint="усі бренди"
            icon={Users}
            tone="info"
          />
          <MissionStatCard
            label="Запуски ШІ · 24h"
            value={data.runs.length}
            hint={`${successRuns} ✓ · ${failedRuns} ✗`}
            icon={Cpu}
            tone={failedRuns > successRuns / 4 ? "destructive" : "primary"}
          />
        </div>
      </section>

      {/* SECTION 2 — увага потрібна */}
      <section className="space-y-4">
        <SectionHeader
          eyebrow="02 · потребує уваги"
          title="Інсайти, дії та ризики"
          icon={AlertTriangle}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <AttentionCard
            label="Інсайти на черзі"
            value={pendingInsights}
            highlight={highRiskInsights}
            highlightLabel="високого ризику"
            icon={Lightbulb}
            tone={highRiskInsights > 5 ? "warning" : "info"}
            href="/admin/overview#stream"
          />
          <AttentionCard
            label="Дії очікують apply"
            value={pendingActions}
            icon={Zap}
            tone={pendingActions > 10 ? "warning" : "primary"}
            href="/admin/commands"
          />
          <AttentionCard
            label="Здоров'я агентів"
            value={fleetHealthy ? "OK" : `${failedRuns} fail`}
            icon={fleetHealthy ? CheckCircle2 : AlertTriangle}
            tone={fleetHealthy ? "success" : "destructive"}
            href="/admin/health"
          />
        </div>
      </section>

      {/* SECTION 3 — пульс по часу + лідери */}
      <section className="space-y-4">
        <SectionHeader
          eyebrow="03 · аналітика"
          title="Cross-tenant pulse"
          hint={`${insightsLoad} відкритих сигналів`}
          icon={Sparkles}
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-border/60 bg-card/60 backdrop-blur lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("mc.crossTenantPulse")}</CardTitle>
              <CardDescription className="text-xs">Виторг по днях, усі бренди</CardDescription>
            </CardHeader>
            <CardContent>
              <CrossTenantPulse points={points} />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/60 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("mc.leaderboard")}</CardTitle>
              <CardDescription className="text-xs">ТОП-10 за виторгом 30д</CardDescription>
            </CardHeader>
            <CardContent>
              <TenantLeaderboard rows={leaderRows} />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* SECTION 4 — здоров'я агентів */}
      <section className="space-y-4">
        <SectionHeader
          eyebrow="04 · флот агентів"
          title="Здоров'я та активність · 24 години"
          hint={`${healthRows.length} агентів запускалися`}
          icon={Cpu}
        />
        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardContent className="pt-6">
            <SystemHealthGrid rows={healthRows} />
          </CardContent>
        </Card>
      </section>

      {/* SECTION 5 — швидкі дії */}
      <section className="space-y-4">
        <SectionHeader
          eyebrow="05 · швидкий доступ"
          title="Куди йти далі"
          icon={Sparkles}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickLink
            to="/admin/tenants"
            icon={Building2}
            tone="primary"
            title="Усі магазини"
            desc="Створити, налаштувати, переглянути деталі"
          />
          <QuickLink
            to="/agents"
            icon={Bot}
            tone="accent"
            title="Бібліотека агентів"
            desc="Запуски наживо · діагностика по кожному"
          />
          <QuickLink
            to="/brand"
            icon={ShoppingBag}
            tone="success"
            title="Кабінет власника"
            desc="Подивитись, як це бачить власник магазину"
          />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function AttentionCard({
  label,
  value,
  highlight,
  highlightLabel,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: number | string;
  highlight?: number;
  highlightLabel?: string;
  icon: typeof Lightbulb;
  tone: "primary" | "success" | "warning" | "destructive" | "info";
  href: string;
}) {
  const toneClass = {
    primary: "text-primary border-primary/40",
    success: "text-success border-success/40",
    warning: "text-warning border-warning/40",
    destructive: "text-destructive border-destructive/40",
    info: "text-info border-info/40",
  }[tone];
  return (
    <Link to={href}>
      <Card
        className={`group border-l-4 ${toneClass.split(" ")[1]} bg-card/60 backdrop-blur transition-all hover:shadow-glow hover:-translate-y-0.5`}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {label}
              </p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
              {highlight !== undefined && highlight > 0 && (
                <Badge variant="outline" className="mt-1 text-[10px]">
                  {highlight} {highlightLabel}
                </Badge>
              )}
            </div>
            <Icon className={`h-5 w-5 ${toneClass.split(" ")[0]} opacity-80`} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickLink({
  to,
  icon: Icon,
  tone,
  title,
  desc,
}: {
  to: string;
  icon: typeof Building2;
  tone: "primary" | "accent" | "success";
  title: string;
  desc: string;
}) {
  const toneClass = {
    primary: "text-primary hover:border-primary/40",
    accent: "text-accent hover:border-accent/40",
    success: "text-success hover:border-success/40",
  }[tone];
  return (
    <Link
      to={to}
      className={`group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-all hover:bg-card/70 hover:shadow-glow ${toneClass}`}
    >
      <Icon className="h-5 w-5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </Link>
  );
}
