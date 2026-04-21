/**
 * Admin dashboard: DN Trade integration health trends.
 *
 * Показує:
 *   - KPI: всього tenants з інтеграцією, % healthy / degraded / unhealthy за 24год.
 *   - Тренд статусів за 24 год (stacked area, погодинно).
 *   - Таблицю tenants з останнім станом, % unhealthy за 24г, останнім check.
 *   - Top blockers / warnings (агреговано за 24г).
 *   - Останні алерти dntrade_unhealthy / dntrade_partial_repeat (з owner_notifications).
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Download,
  ExternalLink,
  HeartPulse,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadHealthCsv } from "@/lib/dntrade/healthCsv";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/dntrade-health")({
  component: DnTradeHealthPage,
});

type HealthRow = {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  status: "healthy" | "degraded" | "unhealthy" | "missing" | "error";
  http_status: number;
  ready: boolean;
  blockers: string[] | null;
  warnings: string[] | null;
  last_sync_status: string | null;
  last_sync_age_seconds: number | null;
  checked_at: string;
};

type TenantRow = { id: string; name: string; slug: string };

type NotificationRow = {
  id: string;
  tenant_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  created_at: string;
  is_read: boolean;
  metadata: Record<string, unknown> | null;
};

const STATUS_TONE: Record<string, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "bg-success/15 text-success border-success/30" },
  degraded: {
    label: "Degraded",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  unhealthy: {
    label: "Unhealthy",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  missing: {
    label: "Missing",
    className: "bg-muted text-muted-foreground border-border",
  },
  error: {
    label: "Error",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
};

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.error;
  return (
    <Badge variant="outline" className={tone.className}>
      {tone.label}
    </Badge>
  );
}

function DnTradeHealthPage() {
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
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return <Navigate to="/brand" />;
  }

  return <DnTradeHealthContent />;
}

function DnTradeHealthContent() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const data = useQuery({
    queryKey: ["dntrade-health-dash"],
    refetchInterval: 60_000,
    queryFn: async () => {
      // Health log за 7 днів — для трендів і агрегації.
      const logRes = await (supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            gte: (
              c: string,
              v: string,
            ) => {
              order: (
                c: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: HealthRow[] | null; error: unknown }>;
            };
          };
        };
      })
        .from("dntrade_health_log")
        .select(
          "id, tenant_id, integration_id, status, http_status, ready, blockers, warnings, last_sync_status, last_sync_age_seconds, checked_at",
        )
        .gte("checked_at", since7d)
        .order("checked_at", { ascending: true });

      const logs = (logRes.data ?? []) as HealthRow[];

      const tenantIds = Array.from(new Set(logs.map((l) => l.tenant_id)));
      const tenantsRes = tenantIds.length
        ? await supabase.from("tenants").select("id, name, slug").in("id", tenantIds)
        : { data: [] as TenantRow[] };
      const tenants = (tenantsRes.data ?? []) as TenantRow[];

      // Останні алерти.
      const notifRes = await supabase
        .from("owner_notifications")
        .select("id, tenant_id, kind, severity, title, body, created_at, is_read, metadata")
        .in("kind", ["dntrade_unhealthy", "dntrade_partial_repeat"])
        .gte("created_at", since7d)
        .order("created_at", { ascending: false })
        .limit(20);
      const notifications = (notifRes.data ?? []) as NotificationRow[];

      return { logs, tenants, notifications };
    },
  });

  const tenantMap = useMemo(
    () => new Map((data.data?.tenants ?? []).map((t) => [t.id, t])),
    [data.data?.tenants],
  );

  // Останній snapshot для кожного tenant.
  const latestPerTenant = useMemo(() => {
    const map = new Map<string, HealthRow>();
    for (const row of data.data?.logs ?? []) {
      const cur = map.get(row.tenant_id);
      if (!cur || cur.checked_at < row.checked_at) {
        map.set(row.tenant_id, row);
      }
    }
    return map;
  }, [data.data?.logs]);

  // KPI за 24г.
  const last24 = useMemo(
    () => (data.data?.logs ?? []).filter((l) => l.checked_at >= since24h),
    [data.data?.logs, since24h],
  );
  const kpi = useMemo(() => {
    const total = last24.length;
    const healthy = last24.filter((l) => l.status === "healthy").length;
    const degraded = last24.filter((l) => l.status === "degraded").length;
    const unhealthy = last24.filter(
      (l) => l.status === "unhealthy" || l.status === "missing" || l.status === "error",
    ).length;
    return {
      total,
      healthy,
      degraded,
      unhealthy,
      tenants: latestPerTenant.size,
      healthyPct: total ? Math.round((healthy / total) * 100) : 0,
      degradedPct: total ? Math.round((degraded / total) * 100) : 0,
      unhealthyPct: total ? Math.round((unhealthy / total) * 100) : 0,
    };
  }, [last24, latestPerTenant.size]);

  // Тренд погодинно за 24г.
  const trend = useMemo(() => {
    const buckets = new Map<
      string,
      { hour: string; healthy: number; degraded: number; unhealthy: number }
    >();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(Date.now() - i * 60 * 60 * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
      buckets.set(key, {
        hour: `${String(d.getHours()).padStart(2, "0")}:00`,
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
      });
    }
    for (const l of last24) {
      const d = new Date(l.checked_at);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
      const b = buckets.get(key);
      if (!b) continue;
      if (l.status === "healthy") b.healthy += 1;
      else if (l.status === "degraded") b.degraded += 1;
      else b.unhealthy += 1;
    }
    return [...buckets.values()];
  }, [last24]);

  // Top blockers / warnings (24г).
  const topReasons = useMemo(() => {
    const blockers = new Map<string, number>();
    const warnings = new Map<string, number>();
    for (const l of last24) {
      for (const b of l.blockers ?? []) {
        blockers.set(b, (blockers.get(b) ?? 0) + 1);
      }
      for (const w of l.warnings ?? []) {
        warnings.set(w, (warnings.get(w) ?? 0) + 1);
      }
    }
    return {
      blockers: [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      warnings: [...warnings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [last24]);

  // Tenant table with % unhealthy.
  const tenantRows = useMemo(() => {
    const perTenant = new Map<
      string,
      { total: number; bad: number; latest: HealthRow | null }
    >();
    for (const l of last24) {
      const cur = perTenant.get(l.tenant_id) ?? { total: 0, bad: 0, latest: null };
      cur.total += 1;
      if (l.status !== "healthy") cur.bad += 1;
      if (!cur.latest || cur.latest.checked_at < l.checked_at) cur.latest = l;
      perTenant.set(l.tenant_id, cur);
    }
    return [...perTenant.entries()]
      .map(([tid, v]) => ({
        tenantId: tid,
        tenant: tenantMap.get(tid),
        latest: v.latest!,
        total: v.total,
        bad: v.bad,
        pctBad: v.total ? Math.round((v.bad / v.total) * 100) : 0,
      }))
      .sort(
        (a, b) =>
          b.pctBad - a.pctBad ||
          (a.tenant?.name ?? "").localeCompare(b.tenant?.name ?? ""),
      );
  }, [last24, tenantMap]);

  if (data.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            Інтеграції
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            DN Trade · Health
          </h1>
          <p className="text-sm text-muted-foreground">
            Тренд стану інтеграцій по всіх брендах · топ блокерів · алерти.
            Оновлюється кожну хвилину.
          </p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <HeartPulse className="h-3.5 w-3.5" /> Tenants з інтеграцією
            </CardDescription>
            <CardTitle className="text-3xl font-bold">{kpi.tenants}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {kpi.total} перевірок за 24 год
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5 backdrop-blur">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Healthy
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-success">
              {kpi.healthyPct}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {kpi.healthy} зі {kpi.total} перевірок
          </CardContent>
        </Card>
        <Card className="border-warning/30 bg-warning/5 backdrop-blur">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlert className="h-3.5 w-3.5" /> Degraded
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-warning">
              {kpi.degradedPct}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {kpi.degraded} з попередженнями
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5 backdrop-blur">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" /> Unhealthy
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-destructive">
              {kpi.unhealthyPct}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {kpi.unhealthy} з блокерами
          </CardContent>
        </Card>
      </div>

      {/* Trend */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Тренд за 24 години</CardTitle>
          <CardDescription className="text-xs">
            Кількість перевірок по статусах, погодинно (UTC)
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="hHealthy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="hDegraded" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--warning))" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="hUnhealthy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="healthy"
                stackId="1"
                stroke="hsl(var(--success))"
                fill="url(#hHealthy)"
                name="Healthy"
              />
              <Area
                type="monotone"
                dataKey="degraded"
                stackId="1"
                stroke="hsl(var(--warning))"
                fill="url(#hDegraded)"
                name="Degraded"
              />
              <Area
                type="monotone"
                dataKey="unhealthy"
                stackId="1"
                stroke="hsl(var(--destructive))"
                fill="url(#hUnhealthy)"
                name="Unhealthy"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top reasons */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-destructive/30 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-destructive" /> Top блокерів · 24г
            </CardTitle>
            <CardDescription className="text-xs">
              Що частіше за все блокує інтеграції
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topReasons.blockers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Блокерів за 24 год немає 🎉</p>
            ) : (
              <ul className="space-y-2">
                {topReasons.blockers.map(([reason, count]) => (
                  <li
                    key={reason}
                    className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{reason}</span>
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      ×{count}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-warning/30 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="h-4 w-4 text-warning" /> Top попереджень · 24г
            </CardTitle>
            <CardDescription className="text-xs">
              Сигнали, які ще не блокують, але вимагають уваги
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topReasons.warnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Без попереджень.</p>
            ) : (
              <ul className="space-y-2">
                {topReasons.warnings.map(([reason, count]) => (
                  <li
                    key={reason}
                    className="flex items-start justify-between gap-3 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{reason}</span>
                    <Badge variant="outline" className="border-warning/40 text-warning">
                      ×{count}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tenant table */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tenants · стан інтеграції</CardTitle>
          <CardDescription className="text-xs">
            Сортування за % проблемних перевірок за 24 год
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenantRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Health-снапшотів за 24 год ще немає. Cron запускається щогодини на :30.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Стан</TableHead>
                  <TableHead className="text-right">% bad · 24г</TableHead>
                  <TableHead className="text-right">Перевірок</TableHead>
                  <TableHead>Останній check</TableHead>
                  <TableHead>Last sync</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenantRows.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TableCell className="font-medium">
                      {row.tenant?.name ?? row.tenantId.slice(0, 8)}
                      {row.tenant?.slug && (
                        <div className="text-[11px] text-muted-foreground">
                          /{row.tenant.slug}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.latest.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          row.pctBad > 50
                            ? "font-semibold text-destructive"
                            : row.pctBad > 20
                              ? "font-semibold text-warning"
                              : "text-success"
                        }
                      >
                        {row.pctBad}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {row.total}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.latest.checked_at).toLocaleString("uk-UA")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.latest.last_sync_status ?? "—"}
                      {row.latest.last_sync_age_seconds != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({Math.round(row.latest.last_sync_age_seconds / 3600)}г)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to="/admin/tenants/$tenantId"
                        params={{ tenantId: row.tenantId }}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Деталі <ExternalLink className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent alerts */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-primary" /> Останні алерти · 7 днів
          </CardTitle>
          <CardDescription className="text-xs">
            З owner_notifications: dntrade_unhealthy / dntrade_partial_repeat
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(data.data?.notifications ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Алертів немає — інтеграції стабільні.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.data!.notifications.map((n) => {
                const tenant = tenantMap.get(n.tenant_id);
                return (
                  <li
                    key={n.id}
                    className="rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        {n.kind === "dntrade_unhealthy" ? (
                          <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                        )}
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {n.title}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {tenant?.name ?? n.tenant_id.slice(0, 8)}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                n.severity === "high"
                                  ? "border-destructive/40 text-destructive text-[10px]"
                                  : "text-[10px]"
                              }
                            >
                              {n.severity}
                            </Badge>
                          </div>
                          {n.body && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                          )}
                        </div>
                      </div>
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleString("uk-UA")}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/5 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" /> Як працює моніторинг
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <code className="rounded bg-background/60 px-1">pg_cron</code> запускає{" "}
            <code className="rounded bg-background/60 px-1">
              /hooks/integrations/dntrade-health-cron
            </code>{" "}
            щогодини на :30. Кожен tenant отримує snapshot у{" "}
            <code className="rounded bg-background/60 px-1">dntrade_health_log</code>; degraded /
            unhealthy додатково логуються у{" "}
            <code className="rounded bg-background/60 px-1">dntrade_sync_errors</code>.
          </p>
          <p>
            Алерт у{" "}
            <code className="rounded bg-background/60 px-1">owner_notifications</code> створюється,
            якщо tenant залишається unhealthy ≥ 30&nbsp;хв або зафіксовано ≥ 3 partial-синки за
            останні 6&nbsp;год. Дедуп — 24&nbsp;години на тип повідомлення.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
