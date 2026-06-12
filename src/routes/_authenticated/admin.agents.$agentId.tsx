/**
 * /admin/agents/$agentId — cross-tenant deep-dive по конкретному агенту.
 * Показує: 24h/7d метрики runs/fail/latency/insights, per-tenant таблицю,
 * heatmap день × tenant за 14 днів, останні 30 runs cross-tenant.
 */
import { createFileRoute, Link, Navigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { humanizeAgentId } from "@/lib/acos/agentLabels";
import { getAgentMeta } from "@/lib/acos/agentCatalog";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/agents/$agentId")({
  component: AdminAgentDetailPage,
});

type RunRow = {
  id: string;
  tenant_id: string | null;
  status: string;
  insights_created: number | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type TenantOpt = { id: string; name: string | null; slug: string | null };

function AdminAgentDetailPage() {
  const { agentId } = useParams({ from: "/_authenticated/admin/agents/$agentId" });
  const { isSuperAdmin, loading } = useAuth();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);

  useEffect(() => {
    void (async () => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const [{ data: r }, { data: t }] = await Promise.all([
        supabase
          .from("acos_agent_runs")
          .select("id, tenant_id, status, insights_created, started_at, finished_at, error")
          .eq("agent_id", agentId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(2000),
        supabase.from("tenants").select("id, name, slug").limit(1000),
      ]);
      setRuns((r ?? []) as RunRow[]);
      setTenants((t ?? []) as TenantOpt[]);
    })();
  }, [agentId]);

  const tenantNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tenants) m.set(t.id, t.name ?? t.slug ?? t.id.slice(0, 8));
    return m;
  }, [tenants]);

  const stats = useMemo(() => {
    const empty = { runs24: 0, fail24: 0, runs7: 0, fail7: 0, insights7: 0, avgLatencyMs: 0 };
    if (!runs) return empty;
    const now = Date.now();
    let runs24 = 0,
      fail24 = 0,
      runs7 = 0,
      fail7 = 0,
      insights7 = 0,
      latSum = 0,
      latN = 0;
    for (const r of runs) {
      const ts = new Date(r.started_at).getTime();
      const age = now - ts;
      if (age <= 7 * 86_400_000) {
        runs7 += 1;
        if (r.status === "failed") fail7 += 1;
        insights7 += r.insights_created ?? 0;
        if (r.finished_at) {
          latSum += new Date(r.finished_at).getTime() - ts;
          latN += 1;
        }
      }
      if (age <= 86_400_000) {
        runs24 += 1;
        if (r.status === "failed") fail24 += 1;
      }
    }
    return {
      runs24,
      fail24,
      runs7,
      fail7,
      insights7,
      avgLatencyMs: latN > 0 ? Math.round(latSum / latN) : 0,
    };
  }, [runs]);

  const perTenant = useMemo(() => {
    if (!runs) return [];
    const map = new Map<
      string,
      { tenant_id: string; runs: number; failed: number; insights: number; lastRun: string }
    >();
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const r of runs) {
      if (new Date(r.started_at).getTime() < cutoff) continue;
      const key = r.tenant_id ?? "—";
      const cur = map.get(key) ?? {
        tenant_id: key,
        runs: 0,
        failed: 0,
        insights: 0,
        lastRun: r.started_at,
      };
      cur.runs += 1;
      if (r.status === "failed") cur.failed += 1;
      cur.insights += r.insights_created ?? 0;
      if (r.started_at > cur.lastRun) cur.lastRun = r.started_at;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.runs - a.runs);
  }, [runs]);

  const heatmap = useMemo(() => {
    if (!runs)
      return { days: [] as string[], tenantIds: [] as string[], cells: new Map<string, number>() };
    const days: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      days.push(d.toISOString().slice(0, 10));
    }
    const cells = new Map<string, number>();
    const tenantsSet = new Set<string>();
    for (const r of runs) {
      const day = r.started_at.slice(0, 10);
      const tid = r.tenant_id ?? "—";
      tenantsSet.add(tid);
      const k = `${tid}::${day}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    return {
      days,
      tenantIds: Array.from(tenantsSet).sort((a, b) =>
        (tenantNameById.get(a) ?? a).localeCompare(tenantNameById.get(b) ?? b),
      ),
      cells,
    };
  }, [runs, tenantNameById]);

  const recent = useMemo(() => (runs ?? []).slice(0, 30), [runs]);
  const meta = getAgentMeta(agentId);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/admin/agents">
          <ArrowLeft className="mr-1 h-4 w-4" /> Усі агенти
        </Link>
      </Button>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          {meta && <Badge variant="outline">{meta.category}</Badge>}
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{humanizeAgentId(agentId)}</h1>
        <p className="font-mono text-xs text-muted-foreground">{agentId}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Runs 24h" value={stats.runs24} />
        <Stat
          label="Fail 24h"
          value={stats.runs24 > 0 ? `${Math.round((stats.fail24 / stats.runs24) * 100)}%` : "—"}
          tone={stats.fail24 / Math.max(stats.runs24, 1) > 0.3 ? "fail" : "ok"}
        />
        <Stat label="Runs 7d" value={stats.runs7} />
        <Stat
          label="Fail 7d"
          value={stats.runs7 > 0 ? `${Math.round((stats.fail7 / stats.runs7) * 100)}%` : "—"}
          tone={stats.fail7 / Math.max(stats.runs7, 1) > 0.1 ? "warn" : "ok"}
        />
        <Stat
          label="Avg latency"
          value={stats.avgLatencyMs > 0 ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-tenant (7 днів)</CardTitle>
          <CardDescription>Розподіл запусків і fail rate по брендах.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {runs === null ? (
            <div className="p-6">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : perTenant.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Немає запусків.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Fail %</TableHead>
                  <TableHead className="text-right">Insights</TableHead>
                  <TableHead className="text-right">Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perTenant.map((row) => {
                  const failRate = row.runs > 0 ? row.failed / row.runs : 0;
                  return (
                    <TableRow key={row.tenant_id}>
                      <TableCell className="max-w-[280px] truncate font-medium">
                        {tenantNameById.get(row.tenant_id) ?? row.tenant_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.runs}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          failRate > 0.3 && "text-destructive",
                          failRate > 0.05 && failRate <= 0.3 && "text-warning",
                        )}
                      >
                        {Math.round(failRate * 100)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.insights}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(row.lastRun), {
                          addSuffix: true,
                          locale: uk,
                        })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Heatmap: день × tenant (14 днів)</CardTitle>
          <CardDescription>Інтенсивність кольору = кількість запусків за день.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs === null ? (
            <Skeleton className="h-32 w-full" />
          ) : heatmap.tenantIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Немає даних.</p>
          ) : (
            <TooltipProvider>
              <table className="border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background p-1" />
                    {heatmap.days.map((d) => (
                      <th key={d} className="p-1 text-[10px] font-normal text-muted-foreground">
                        {d.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.tenantIds.map((tid) => (
                    <tr key={tid}>
                      <td className="sticky left-0 z-10 max-w-[160px] truncate bg-background p-1 pr-3 text-xs font-medium">
                        {tenantNameById.get(tid) ?? tid.slice(0, 8)}
                      </td>
                      {heatmap.days.map((d) => {
                        const count = heatmap.cells.get(`${tid}::${d}`) ?? 0;
                        const intensity = Math.min(1, count / 10);
                        return (
                          <td key={d}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="h-6 w-8 rounded"
                                  style={{
                                    backgroundColor:
                                      count === 0
                                        ? "hsl(var(--muted) / 0.3)"
                                        : `hsl(var(--primary) / ${0.15 + intensity * 0.7})`,
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {d}: {count} runs
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Останні 30 runs (cross-tenant)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs === null ? (
            <div className="p-6">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : recent.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Немає запусків.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Insights</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => {
                  const latency =
                    r.finished_at != null
                      ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
                      : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {r.tenant_id
                          ? (tenantNameById.get(r.tenant_id) ?? r.tenant_id.slice(0, 8))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-xs">
                          {r.status === "success" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          ) : r.status === "failed" ? (
                            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                          ) : (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.insights_created ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {latency != null ? `${(latency / 1000).toFixed(1)}s` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.started_at), {
                          addSuffix: true,
                          locale: uk,
                        })}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-destructive">
                        {r.error ?? ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "fail";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "fail" && "border-destructive/40 bg-destructive/5",
        tone === "warn" && "border-warning/40 bg-warning/5",
        tone === "ok" && "border-border/60 bg-card/50",
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
