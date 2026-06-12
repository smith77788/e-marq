/**
 * /admin/outcomes — Measurement loop dashboard for super-admins.
 * Aggregates action_outcomes cross-tenant: win-rate, attributed revenue,
 * breakdowns by action_type and tenant, recent outcomes list.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, CheckCircle2, MinusCircle, TrendingUp, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/outcomes")({
  head: () => ({
    meta: [
      { title: "Цикл вимірювань — MARQ" },
      { name: "description", content: "Cross-tenant action outcomes" },
    ],
  }),
  component: AdminOutcomes,
});

type OutcomeRow = {
  id: string;
  tenant_id: string;
  decision_id: string | null;
  action_id: string | null;
  agent_id: string;
  action_type: string;
  attributed_revenue_cents: number;
  success: boolean | null;
  measurement_window: string;
  measured_at: string;
  notes: string | null;
};

type TenantRow = { id: string; name: string | null };

const RANGE_OPTIONS = [
  { value: "24h", label: "24 години", hours: 24 },
  { value: "7d", label: "7 днів", hours: 24 * 7 },
  { value: "30d", label: "30 днів", hours: 24 * 30 },
  { value: "all", label: "Усі", hours: 0 },
];

function fmtMoney(cents: number) {
  return `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;
}

function AdminOutcomes() {
  const { isSuperAdmin, loading } = useAuth();
  const [rows, setRows] = useState<OutcomeRow[] | null>(null);
  const [tenants, setTenants] = useState<Record<string, string>>({});
  const [range, setRange] = useState("7d");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const sel = await supabase
          .from("action_outcomes")
          .select(
            "id, tenant_id, decision_id, action_id, agent_id, action_type, attributed_revenue_cents, success, measurement_window, measured_at, notes",
          )
          .order("measured_at", { ascending: false })
          .limit(2000);
        if (sel.error) throw sel.error;
        const data = (sel.data ?? []) as OutcomeRow[];
        setRows(data);
        const ids = Array.from(new Set(data.map((r) => r.tenant_id)));
        if (ids.length) {
          const t = await supabase.from("tenants").select("id, name").in("id", ids);
          if (t.data) {
            const map: Record<string, string> = {};
            (t.data as TenantRow[]).forEach((x) => {
              map[x.id] = x.name ?? x.id.slice(0, 8);
            });
            setTenants(map);
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const opt = RANGE_OPTIONS.find((o) => o.value === range);
    if (!opt || opt.hours === 0) return rows;
    const cutoff = Date.now() - opt.hours * 3600_000;
    return rows.filter((r) => new Date(r.measured_at).getTime() >= cutoff);
  }, [rows, range]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const measured = filtered.filter((r) => r.success !== null);
    const wins = measured.filter((r) => r.success === true).length;
    const losses = measured.filter((r) => r.success === false).length;
    const winRate = measured.length ? wins / measured.length : 0;
    const revenue = filtered.reduce((s, r) => s + (Number(r.attributed_revenue_cents) || 0), 0);
    return { total, measured: measured.length, wins, losses, winRate, revenue };
  }, [filtered]);

  const byActionType = useMemo(() => {
    const m = new Map<string, { count: number; wins: number; measured: number; revenue: number }>();
    for (const r of filtered) {
      const cur = m.get(r.action_type) ?? { count: 0, wins: 0, measured: 0, revenue: 0 };
      cur.count++;
      if (r.success !== null) cur.measured++;
      if (r.success === true) cur.wins++;
      cur.revenue += Number(r.attributed_revenue_cents) || 0;
      m.set(r.action_type, cur);
    }
    return Array.from(m.entries())
      .map(([k, v]) => ({ action_type: k, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const byTenant = useMemo(() => {
    const m = new Map<string, { count: number; wins: number; measured: number; revenue: number }>();
    for (const r of filtered) {
      const cur = m.get(r.tenant_id) ?? { count: 0, wins: 0, measured: 0, revenue: 0 };
      cur.count++;
      if (r.success !== null) cur.measured++;
      if (r.success === true) cur.wins++;
      cur.revenue += Number(r.attributed_revenue_cents) || 0;
      m.set(r.tenant_id, cur);
    }
    return Array.from(m.entries())
      .map(([k, v]) => ({ tenant_id: k, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Activity className="h-6 w-6 text-primary" />
            Цикл вимірювань
          </h1>
          <p className="text-sm text-muted-foreground">
            Що сталося після кожної виконаної дії: win-rate, revenue, breakdowns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/decisions">Рішення агентів</Link>
          </Button>
        </div>
      </header>

      {err && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{err}</CardContent>
        </Card>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Outcomes"
          value={summary.total.toString()}
          hint={`${summary.measured} виміряно`}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label="Win rate"
          value={`${Math.round(summary.winRate * 100)}%`}
          hint={`${summary.wins} win · ${summary.losses} loss`}
        />
        <StatCard
          icon={<Wallet className="h-4 w-4 text-primary" />}
          label="Attributed revenue"
          value={fmtMoney(summary.revenue)}
          hint="за обраний період"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-accent" />}
          label="Avg / outcome"
          value={summary.total ? fmtMoney(Math.round(summary.revenue / summary.total)) : "—"}
          hint="середній impact"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">По типу дії</CardTitle>
            <CardDescription>Win rate і revenue по action_type</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {byActionType.map((r) => {
                  const wr = r.measured ? r.wins / r.measured : 0;
                  return (
                    <TableRow key={r.action_type}>
                      <TableCell className="font-mono text-xs">{r.action_type}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          r.measured && wr >= 0.5 && "text-success",
                          r.measured && wr < 0.3 && "text-destructive",
                        )}
                      >
                        {r.measured ? `${Math.round(wr * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtMoney(r.revenue)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows && byActionType.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      Немає даних
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">По tenant</CardTitle>
            <CardDescription>Хто отримує найбільше impact</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byTenant.map((r) => {
                  const wr = r.measured ? r.wins / r.measured : 0;
                  return (
                    <TableRow key={r.tenant_id}>
                      <TableCell className="text-xs">
                        {tenants[r.tenant_id] ?? r.tenant_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          r.measured && wr >= 0.5 && "text-success",
                          r.measured && wr < 0.3 && "text-destructive",
                        )}
                      >
                        {r.measured ? `${Math.round(wr * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtMoney(r.revenue)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows && byTenant.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      Немає даних
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Останні outcomes</CardTitle>
          <CardDescription>Топ-50 свіжих вимірювань</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Коли</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 50).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(r.measured_at), { addSuffix: true, locale: uk })}
                  </TableCell>
                  <TableCell className="text-xs">
                    {tenants[r.tenant_id] ?? r.tenant_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action_type}</TableCell>
                  <TableCell className="text-xs">
                    <Link
                      to="/admin/agents/$agentId"
                      params={{ agentId: r.agent_id }}
                      className="hover:underline"
                    >
                      {r.agent_id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {fmtMoney(r.attributed_revenue_cents)}
                  </TableCell>
                  <TableCell>
                    {r.success === true && (
                      <Badge
                        variant="outline"
                        className="border-success/30 bg-success/10 text-success"
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" /> win
                      </Badge>
                    )}
                    {r.success === false && (
                      <Badge variant="outline" className="text-muted-foreground">
                        <MinusCircle className="mr-1 h-3 w-3" /> no lift
                      </Badge>
                    )}
                    {r.success === null && (
                      <Badge variant="outline" className="text-xs">
                        pending
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && rows && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Поки нічого не виміряно
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
