import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Building2,
  Cpu,
  DollarSign,
  Lightbulb,
  ShoppingBag,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { MissionStatCard } from "@/components/admin/MissionStatCard";
import {
  TenantLeaderboard,
  type TenantLeaderRow,
} from "@/components/admin/TenantLeaderboard";
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

  if (!isSuperAdmin) {
    return <Navigate to="/brand" />;
  }

  return <MissionControlContent />;
}

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
        <Skeleton className="h-16 w-full" />
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

  // Build leaderboard
  const tenantMap = new Map(data.tenants.map((t) => [t.id, t]));
  const leaderRows: TenantLeaderRow[] = data.tenants
    .map((t) => {
      const tenantOrders = data.orders.filter(
        (o) => o.tenant_id === t.id && o.status === "paid",
      );
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            {t("mc.title")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("mc.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("mc.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/tenants">
              <Building2 className="mr-1.5 h-4 w-4" /> {t("sb.allTenants")}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/agents">
              <Bot className="mr-1.5 h-4 w-4" /> {t("sb.agents")}
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MissionStatCard
          label={t("mc.activeTenants")}
          value={data.tenants.length}
          hint={`${data.tenants.filter((t) => t.status === "active").length} ${t("hero.active").split(" ·")[0]}`}
          icon={Building2}
          tone="primary"
        />
        <MissionStatCard
          label={t("mc.gmv30")}
          value={`$${(totalRevenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint={`${paidOrders} ${t("sb.revenue").toLowerCase()}`}
          icon={DollarSign}
          tone="success"
        />
        <MissionStatCard
          label={t("mc.insights24h")}
          value={pendingInsights}
          hint={`${highRiskInsights} ⚠`}
          icon={Lightbulb}
          tone={highRiskInsights > 5 ? "warning" : "info"}
        />
        <MissionStatCard
          label={t("mc.runs24h")}
          value={data.runs.length}
          hint={`${successRuns} ✓ · ${failedRuns} ✗`}
          icon={Activity}
          tone={failedRuns > successRuns / 4 ? "destructive" : "primary"}
        />
      </div>

      {/* Secondary KPI row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MissionStatCard
          label={t("mc.totalCustomers")}
          value={data.customers.length.toLocaleString()}
          icon={Users}
          tone="info"
        />
        <MissionStatCard
          label={t("mc.pendingActions")}
          value={pendingActions}
          icon={Zap}
          tone="warning"
        />
        <MissionStatCard
          label={t("mc.insights24h")}
          value={data.insights.length.toLocaleString()}
          icon={Sparkles}
          tone="primary"
        />
      </div>

      {/* Pulse + Leaderboard */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-border/60 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("mc.crossTenantPulse")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CrossTenantPulse points={points} />
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("mc.leaderboard")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TenantLeaderboard rows={leaderRows} />
          </CardContent>
        </Card>
      </div>

      {/* Agent health */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("mc.systemHealth")} · 24h</CardTitle>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Cpu className="h-4 w-4 text-primary" />
              <span>{healthRows.length}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <SystemHealthGrid rows={healthRows} />
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          to="/admin/tenants"
          className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-all hover:border-primary/40 hover:bg-card/70 hover:shadow-glow"
        >
          <Building2 className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">All tenants</p>
            <p className="text-xs text-muted-foreground">Provision · configure · drill-down</p>
          </div>
        </Link>
        <Link
          to="/agents"
          className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-all hover:border-accent/40 hover:bg-card/70 hover:shadow-glow"
        >
          <Bot className="h-5 w-5 text-accent" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Agent library</p>
            <p className="text-xs text-muted-foreground">Live runs · per-agent diagnostics</p>
          </div>
        </Link>
        <Link
          to="/brand"
          className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-all hover:border-success/40 hover:bg-card/70 hover:shadow-glow"
        >
          <ShoppingBag className="h-5 w-5 text-success" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Owner cockpit</p>
            <p className="text-xs text-muted-foreground">Preview the brand-side experience</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
