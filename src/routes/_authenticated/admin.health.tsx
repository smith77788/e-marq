/**
 * Tenant Health Monitor — single screen for super-admins to spot which
 * tenants need attention. Each row is a "traffic-light" across 5 dimensions:
 *   1. Agent runs (24h) — fail rate
 *   2. DN Trade sync   — staleness of last sync
 *   3. Email (7d)      — bounce + complaint rate
 *   4. Balance         — depleted vs healthy
 *   5. Orders (24h)    — pending pile-up
 *
 * The overall status is the worst sub-status. Auto-refreshes every 30s.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HeartPulse,
  Loader2,
  RefreshCw,
  XCircle,
  CircleDashed,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT, tStatic } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/money";
import { CronHealthCard } from "@/components/admin/CronHealthCard";

export const Route = createFileRoute("/_authenticated/admin/health")({
  head: () => ({
    meta: [
      { title: tStatic("hm.title") },
      { name: "description", content: tStatic("hm.subtitle") },
    ],
  }),
  component: HealthMonitorRoute,
});

type Status = "ok" | "warn" | "fail" | "idle";

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type AgentRunRow = { tenant_id: string; status: string };
type IntegrationRow = {
  tenant_id: string;
  provider: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
};
type EmailSendRow = { tenant_id: string; status: string };
type BalanceRow = { tenant_id: string; money_balance_cents: number; currency: string | null };
type OrderRow = { tenant_id: string; status: string };

type TenantHealth = {
  tenant: TenantRow;
  overall: Status;
  agents: { status: Status; total: number; failed: number };
  dntrade: { status: Status; ageHours: number | null; configured: boolean };
  email: { status: Status; delivered: number; bounced: number; total: number };
  balance: { status: Status; amountCents: number; currency: string };
  orders: { status: Status; paid: number; pending: number };
};

const WORST: Record<Status, number> = { ok: 0, idle: 1, warn: 2, fail: 3 };

function worst(...statuses: Status[]): Status {
  return statuses.reduce((acc, s) => (WORST[s] > WORST[acc] ? s : acc), "ok" as Status);
}

function HealthMonitorRoute() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <HealthMonitorContent />;
}

function HealthMonitorContent() {
  const { t } = useT();
  const [showOnlyUnhealthy, setShowOnlyUnhealthy] = useState(false);

  const since24h = useMemo(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), []);
  const since7d = useMemo(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), []);

  const query = useQuery({
    queryKey: ["admin-health", since24h, since7d],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [tenants, runs, integrations, emails, balances, orders] = await Promise.all([
        supabase
          .from("tenants")
          .select("id, name, slug, status")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("acos_agent_runs")
          .select("tenant_id, status")
          .gte("started_at", since24h)
          .limit(20000),
        supabase
          .from("tenant_integrations")
          .select("tenant_id, provider, last_sync_at, last_sync_status")
          .eq("provider", "dntrade")
          .limit(1000),
        supabase
          .from("email_sends")
          .select("tenant_id, status")
          .gte("created_at", since7d)
          .limit(20000),
        supabase.from("tenant_balances").select("tenant_id, money_balance_cents, currency").limit(1000),
        supabase
          .from("orders")
          .select("tenant_id, status")
          .gte("created_at", since24h)
          .limit(20000),
      ]);
      if (tenants.error) throw tenants.error;
      return {
        tenants: (tenants.data ?? []) as TenantRow[],
        runs: (runs.data ?? []) as AgentRunRow[],
        integrations: (integrations.data ?? []) as IntegrationRow[],
        emails: (emails.data ?? []) as EmailSendRow[],
        balances: (balances.data ?? []) as BalanceRow[],
        orders: (orders.data ?? []) as OrderRow[],
      };
    },
  });

  const rows: TenantHealth[] = useMemo(() => {
    if (!query.data) return [];
    const byTenant = <T extends { tenant_id: string }>(arr: T[]) => {
      const m = new Map<string, T[]>();
      for (const item of arr) {
        const list = m.get(item.tenant_id) ?? [];
        list.push(item);
        m.set(item.tenant_id, list);
      }
      return m;
    };
    const runsBy = byTenant(query.data.runs);
    const intBy = byTenant(query.data.integrations);
    const emailBy = byTenant(query.data.emails);
    const balBy = byTenant(query.data.balances);
    const ordBy = byTenant(query.data.orders);
    const now = Date.now();

    return query.data.tenants.map((tenant) => {
      // Agents
      const tRuns = runsBy.get(tenant.id) ?? [];
      const total = tRuns.length;
      const failed = tRuns.filter((r) => r.status === "failed").length;
      const failRate = total > 0 ? failed / total : 0;
      const agents: TenantHealth["agents"] = {
        total,
        failed,
        status: total === 0 ? "idle" : failRate > 0.3 ? "fail" : failRate > 0.05 ? "warn" : "ok",
      };

      // DN Trade
      const dnInt = (intBy.get(tenant.id) ?? []).find((i) => i.provider === "dntrade");
      let dntrade: TenantHealth["dntrade"];
      if (!dnInt) {
        dntrade = { status: "idle", ageHours: null, configured: false };
      } else if (!dnInt.last_sync_at) {
        dntrade = { status: "warn", ageHours: null, configured: true };
      } else {
        const ageHours = (now - new Date(dnInt.last_sync_at).getTime()) / (1000 * 60 * 60);
        const failedSync =
          dnInt.last_sync_status === "failed" || dnInt.last_sync_status === "error";
        dntrade = {
          configured: true,
          ageHours,
          status: failedSync || ageHours > 48 ? "fail" : ageHours > 12 ? "warn" : "ok",
        };
      }

      // Email
      const tEmail = emailBy.get(tenant.id) ?? [];
      const delivered = tEmail.filter(
        (e) => e.status === "delivered" || e.status === "sent",
      ).length;
      const bounced = tEmail.filter(
        (e) => e.status === "bounced" || e.status === "complained",
      ).length;
      const totalEmail = tEmail.length;
      const bounceRate = totalEmail > 0 ? bounced / totalEmail : 0;
      const email: TenantHealth["email"] = {
        delivered,
        bounced,
        total: totalEmail,
        status:
          totalEmail === 0 ? "idle" : bounceRate > 0.1 ? "fail" : bounceRate > 0.03 ? "warn" : "ok",
      };

      // Orders
      const tOrd = ordBy.get(tenant.id) ?? [];
      const paid = tOrd.filter((o) => o.status === "paid").length;
      const pending = tOrd.filter((o) => o.status === "pending").length;
      const orders: TenantHealth["orders"] = {
        paid,
        pending,
        status: pending > 10 ? "warn" : tOrd.length === 0 ? "idle" : "ok",
      };

      // Balance — for a brand-new tenant (no balance row OR row with 0 funds
      // and no agent activity yet) we show "idle" instead of "fail" to avoid
      // scaring owners during onboarding. We only flag fail when the tenant
      // is actively running agents but balance ran out.
      const bal = (balBy.get(tenant.id) ?? [])[0];
      const amountCents = bal?.money_balance_cents ?? 0;
      const tenantHasActivity = total > 0 || tEmail.length > 0 || tOrd.length > 0;
      let balanceStatus: Status;
      if (!bal) balanceStatus = "idle";
      else if (amountCents <= 0) balanceStatus = tenantHasActivity ? "fail" : "idle";
      else if (amountCents < 50000) balanceStatus = "warn";
      else balanceStatus = "ok";
      const balance: TenantHealth["balance"] = {
        amountCents,
        currency: bal?.currency ?? "UAH",
        status: balanceStatus,
      };

      const overall = worst(
        agents.status,
        dntrade.status,
        email.status,
        balance.status,
        orders.status,
      );
      return { tenant, overall, agents, dntrade, email, balance, orders };
    });
  }, [query.data]);

  const filtered = useMemo(
    () =>
      showOnlyUnhealthy ? rows.filter((r) => r.overall === "warn" || r.overall === "fail") : rows,
    [rows, showOnlyUnhealthy],
  );

  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, fail: 0, idle: 0 };
    for (const r of rows) c[r.overall] += 1;
    return c;
  }, [rows]);

  const lastFetched = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Badge
              variant="outline"
              className="border-destructive/30 bg-destructive/5 text-destructive"
            >
              <HeartPulse className="mr-1 h-3 w-3" /> {t("hm.title")}
            </Badge>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t("hm.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("hm.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {query.isFetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {t("hm.refreshing")}
            </span>
            <span>{t("hm.lastChecked").replace("{time}", lastFetched)}</span>
          </div>
        </div>

        {/* Summary chips */}
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryChip
            tone="ok"
            label={t("hm.healthyCount").replace("{n}", String(counts.ok))}
            icon={CheckCircle2}
          />
          <SummaryChip
            tone="warn"
            label={t("hm.warnCount").replace("{n}", String(counts.warn))}
            icon={AlertTriangle}
          />
          <SummaryChip
            tone="fail"
            label={t("hm.failCount").replace("{n}", String(counts.fail))}
            icon={XCircle}
          />
        </div>

        <CronHealthCard />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">{t("hm.title")}</CardTitle>
              <CardDescription>
                {filtered.length} / {rows.length}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="only-unhealthy" className="text-xs text-muted-foreground">
                {t("hm.filterUnhealthy")}
              </Label>
              <Switch
                id="only-unhealthy"
                checked={showOnlyUnhealthy}
                onCheckedChange={setShowOnlyUnhealthy}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="space-y-2 p-6">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : query.isError ? (
              <p className="p-6 text-sm text-destructive">
                Не вдалося завантажити дані.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void query.refetch()}
                >
                  Повторити
                </button>
              </p>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {showOnlyUnhealthy ? t("hm.emptyFiltered") : t("hm.empty")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("hm.colTenant")}</TableHead>
                      <TableHead>{t("hm.colOverall")}</TableHead>
                      <TableHead className="text-center">{t("hm.colAgents")}</TableHead>
                      <TableHead className="text-center">{t("hm.colDntrade")}</TableHead>
                      <TableHead className="text-center">{t("hm.colEmail")}</TableHead>
                      <TableHead className="text-center">{t("hm.colBalance")}</TableHead>
                      <TableHead className="text-center">{t("hm.colOrders")}</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => (
                      <HealthRow key={row.tenant.id} row={row} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function HealthRow({ row }: { row: TenantHealth }) {
  const { t } = useT();

  const ageLabel = (h: number | null) => {
    if (h == null) return t("hm.tipDntradeNever");
    if (h < 1) return `${Math.round(h * 60)} min`;
    if (h < 48) return `${Math.round(h)}h`;
    return `${Math.round(h / 24)}d`;
  };

  return (
    <TableRow className="hover:bg-accent/5">
      <TableCell>
        <Link
          to="/admin/tenants/$tenantId"
          params={{ tenantId: row.tenant.id }}
          className="block font-medium text-foreground hover:underline"
        >
          {row.tenant.name}
        </Link>
        <p className="text-xs text-muted-foreground">/{row.tenant.slug}</p>
      </TableCell>

      <TableCell>
        <OverallBadge status={row.overall} />
      </TableCell>

      <TableCell className="text-center">
        <Dot
          status={row.agents.status}
          tip={t("hm.tipAgents")
            .replace("{total}", String(row.agents.total))
            .replace("{failed}", String(row.agents.failed))}
        />
      </TableCell>

      <TableCell className="text-center">
        <Dot
          status={row.dntrade.status}
          tip={
            row.dntrade.configured
              ? t("hm.tipDntrade").replace("{age}", ageLabel(row.dntrade.ageHours))
              : t("hm.tipDntradeNever")
          }
        />
      </TableCell>

      <TableCell className="text-center">
        <Dot
          status={row.email.status}
          tip={
            row.email.total === 0
              ? t("hm.tipEmailNoSends")
              : t("hm.tipEmail")
                  .replace("{delivered}", String(row.email.delivered))
                  .replace("{bounced}", String(row.email.bounced))
          }
        />
      </TableCell>

      <TableCell className="text-center">
        <Dot
          status={row.balance.status}
          tip={t("hm.tipBalance").replace(
            "{balance}",
            `${formatMoney(row.balance.amountCents)} ${row.balance.currency}`,
          )}
        />
      </TableCell>

      <TableCell className="text-center">
        <Dot
          status={row.orders.status}
          tip={t("hm.tipOrders")
            .replace("{paid}", String(row.orders.paid))
            .replace("{pending}", String(row.orders.pending))}
        />
      </TableCell>

      <TableCell className="text-right">
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/tenants/$tenantId" params={{ tenantId: row.tenant.id }}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function Dot({ status, tip }: { status: Status; tip: string }) {
  const cls =
    status === "ok"
      ? "bg-success/15 text-success ring-success/30"
      : status === "warn"
        ? "bg-warning/15 text-warning ring-warning/30"
        : status === "fail"
          ? "bg-destructive/15 text-destructive ring-destructive/40"
          : "bg-muted text-muted-foreground ring-muted-foreground/20";
  const Icon =
    status === "ok"
      ? CheckCircle2
      : status === "warn"
        ? AlertTriangle
        : status === "fail"
          ? XCircle
          : CircleDashed;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition",
            cls,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function OverallBadge({ status }: { status: Status }) {
  const { t } = useT();
  const cls =
    status === "ok"
      ? "border-success/30 bg-success/10 text-success"
      : status === "warn"
        ? "border-warning/30 bg-warning/10 text-warning"
        : status === "fail"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-muted-foreground/30 bg-muted text-muted-foreground";
  const label =
    status === "ok"
      ? t("hm.statusOk")
      : status === "warn"
        ? t("hm.statusWarn")
        : status === "fail"
          ? t("hm.statusFail")
          : t("hm.statusIdle");
  return (
    <Badge variant="outline" className={cn("text-xs font-semibold", cls)}>
      {label}
    </Badge>
  );
}

function SummaryChip({
  tone,
  label,
  icon: Icon,
}: {
  tone: "ok" | "warn" | "fail";
  label: string;
  icon: typeof CheckCircle2;
}) {
  const cls =
    tone === "ok"
      ? "border-success/30 bg-success/5 text-success"
      : tone === "warn"
        ? "border-warning/30 bg-warning/5 text-warning"
        : "border-destructive/40 bg-destructive/5 text-destructive";
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-4", cls)}>
      <Icon className="h-5 w-5" />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}
