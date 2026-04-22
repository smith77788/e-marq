/**
 * Drill-down: повна історія health-перевірок DN Trade за 30 днів для одного tenant.
 * Показує тренд по днях, поточний стан, історію блокерів/warnings, останні sync-помилки.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  HeartPulse,
  History,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { downloadHealthCsv, type HealthLogRow } from "@/lib/dntrade/healthCsv";

export const Route = createFileRoute("/_authenticated/admin/dntrade-health/$tenantId")({
  component: TenantDrillDownPage,
});

const STATUS_TONE: Record<string, { label: string; className: string }> = {
  healthy: { label: "Працює", className: "bg-success/15 text-success border-success/30" },
  degraded: {
    label: "З попередженнями",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  unhealthy: {
    label: "Не працює",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  missing: { label: "Не підключено", className: "bg-muted text-muted-foreground border-border" },
  error: {
    label: "Помилка",
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

type SyncErrorRow = {
  id: string;
  kind: string;
  message: string;
  occurred_at: string;
  external_id: string | null;
};

function TenantDrillDownPage() {
  const { isSuperAdmin, loading } = useAuth();
  const { tenantId } = Route.useParams();

  if (loading) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <Drill tenantId={tenantId} />;
}

function Drill({ tenantId }: { tenantId: string }) {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const data = useQuery({
    queryKey: ["dntrade-health-drill", tenantId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const sb = supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              gte: (
                c: string,
                v: string,
              ) => {
                order: (
                  c: string,
                  opts: { ascending: boolean },
                ) => Promise<{ data: HealthLogRow[] | null; error: unknown }>;
              };
            };
          };
        };
      };

      const [logRes, tenantRes, errRes] = await Promise.all([
        sb
          .from("dntrade_health_log")
          .select(
            "id, tenant_id, integration_id, status, http_status, ready, blockers, warnings, last_sync_status, last_sync_age_seconds, checked_at",
          )
          .eq("tenant_id", tenantId)
          .gte("checked_at", since30d)
          .order("checked_at", { ascending: false }),
        supabase.from("tenants").select("id, name, slug").eq("id", tenantId).maybeSingle(),
        supabase
          .from("dntrade_sync_errors")
          .select("id, kind, message, occurred_at, external_id")
          .eq("tenant_id", tenantId)
          .gte("occurred_at", since30d)
          .order("occurred_at", { ascending: false })
          .limit(50),
      ]);
      return {
        logs: (logRes.data ?? []) as HealthLogRow[],
        tenant: tenantRes.data as { id: string; name: string; slug: string } | null,
        syncErrors: (errRes.data ?? []) as SyncErrorRow[],
      };
    },
  });

  const logs = useMemo(() => data.data?.logs ?? [], [data.data?.logs]);

  // Тренд по днях.
  const dailyTrend = useMemo(() => {
    const buckets = new Map<
      string,
      { day: string; healthy: number; degraded: number; unhealthy: number }
    >();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, {
        day: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`,
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
      });
    }
    for (const l of logs) {
      const key = l.checked_at.slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      if (l.status === "healthy") b.healthy += 1;
      else if (l.status === "degraded") b.degraded += 1;
      else b.unhealthy += 1;
    }
    return [...buckets.values()];
  }, [logs]);

  const stats = useMemo(() => {
    const total = logs.length;
    const healthy = logs.filter((l) => l.status === "healthy").length;
    const degraded = logs.filter((l) => l.status === "degraded").length;
    const unhealthy = total - healthy - degraded;
    return {
      total,
      healthy,
      degraded,
      unhealthy,
      latest: logs[0] ?? null,
      uptimePct: total ? Math.round((healthy / total) * 100) : 0,
    };
  }, [logs]);

  if (data.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  const tenantLabel = data.data?.tenant?.name ?? tenantId.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/admin/dntrade-health"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Назад до загального огляду
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            DN Trade · {tenantLabel}
          </h1>
          <p className="text-sm text-muted-foreground">
            Історія перевірок за 30 днів · {logs.length} перевірок
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadHealthCsv(logs, `dntrade-health-${tenantLabel}-30d.csv`)}
          disabled={logs.length === 0}
        >
          <Download className="mr-1 h-3.5 w-3.5" /> Завантажити CSV
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <HeartPulse className="h-3.5 w-3.5" /> Поточний стан
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.latest ? (
              <StatusBadge status={stats.latest.status} />
            ) : (
              <p className="text-sm text-muted-foreground">Немає даних</p>
            )}
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Час безперебійної роботи · 30 днів
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-success">{stats.uptimePct}%</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {stats.healthy} з {stats.total} перевірок успішні
          </CardContent>
        </Card>
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlert className="h-3.5 w-3.5" /> З попередженнями
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-warning">{stats.degraded}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">перевірок</CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" /> Не працює
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-destructive">{stats.unhealthy}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">перевірок</CardContent>
        </Card>
      </div>

      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Як змінювався стан за 30 днів</CardTitle>
          <CardDescription className="text-xs">Кількість перевірок щодня</CardDescription>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyTrend}>
              <defs>
                <linearGradient id="dHealthy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--success, var(--primary))" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--success, var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dDegraded" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--warning, var(--primary))" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--warning, var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dUnhealthy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--destructive)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
              <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="healthy"
                stackId="1"
                stroke="var(--success, var(--primary))"
                fill="url(#dHealthy)"
                name="Працює"
              />
              <Area
                type="monotone"
                dataKey="degraded"
                stackId="1"
                stroke="var(--warning, var(--primary))"
                fill="url(#dDegraded)"
                name="Попередження"
              />
              <Area
                type="monotone"
                dataKey="unhealthy"
                stackId="1"
                stroke="var(--destructive)"
                fill="url(#dUnhealthy)"
                name="Не працює"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Історія перевірок (останні 50)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Перевірок ще не було.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Коли перевіряли</TableHead>
                  <TableHead>Стан</TableHead>
                  <TableHead>Код</TableHead>
                  <TableHead>Остання синхронізація</TableHead>
                  <TableHead>Помилки / попередження</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.slice(0, 50).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(l.checked_at).toLocaleString("uk-UA")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-xs">{l.http_status}</TableCell>
                    <TableCell className="text-xs">
                      {l.last_sync_status ?? "—"}
                      {l.last_sync_age_seconds != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({Math.round(l.last_sync_age_seconds / 3600)}г)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(l.blockers ?? []).length === 0 && (l.warnings ?? []).length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-1">
                          {(l.blockers ?? []).map((b, i) => (
                            <div key={`b${i}`} className="text-destructive">
                              ⛔ {b}
                            </div>
                          ))}
                          {(l.warnings ?? []).map((w, i) => (
                            <div key={`w${i}`} className="text-warning">
                              ⚠ {w}
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Помилки синхронізації за 30 днів</CardTitle>
          <CardDescription className="text-xs">До 50 останніх записів</CardDescription>
        </CardHeader>
        <CardContent>
          {(data.data?.syncErrors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Помилок не зафіксовано.</p>
          ) : (
            <ul className="space-y-2">
              {data.data!.syncErrors.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {e.kind}
                        </Badge>
                        {e.external_id && (
                          <code className="text-[10px] text-muted-foreground">{e.external_id}</code>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-foreground">{e.message}</p>
                    </div>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleString("uk-UA")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
