/**
 * Owner billing view: current plan, balances, ledger history.
 * Read-only: owners see what they have but cannot self-upgrade in this iteration.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ArrowDownLeft, ArrowUpRight, Coins, Crown, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { PlanBadge } from "@/components/admin/PlanBadge";
import { cn } from "@/lib/utils";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/billing")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandBillingPage,
});

function BrandBillingPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/billing" });
  const { current, currentTenantId, setCurrentTenantId } = useTenantContext();

  // Sync URL → context
  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId = urlTenant ?? currentTenantId ?? current?.tenant_id;

  const summaryQuery = useQuery({
    queryKey: ["plan-summary", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", { _tenant_id: tenantId! });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  const ledgerQuery = useQuery({
    queryKey: ["balance-ledger", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("balance_ledger")
        .select("id, kind, direction, amount, balance_after, reason, reference_kind, created_at")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  if (!tenantId) {
    return (
      <Card>
        <CardHeader><CardTitle>No brand selected</CardTitle></CardHeader>
        <CardContent>
          <Link to="/brand" className="text-primary hover:underline">← Back to dashboard</Link>
        </CardContent>
      </Card>
    );
  }

  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/brand" search={{ tenant: tenantId }} className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to {current?.tenant_name ?? "brand"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Billing & balance</h1>
      </div>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-warning" />
              Your plan
              <PlanBadge planKey={summary.plan.key} planName={summary.plan.name} />
            </CardTitle>
            <CardDescription>
              Status: {summary.subscription.status} · Period {new Date(summary.subscription.current_period_start).toLocaleDateString()} → {new Date(summary.subscription.current_period_end).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeters summary={summary} />
            <div className="grid gap-3 sm:grid-cols-2">
              <BalanceTile
                icon={<Coins className="h-5 w-5 text-primary" />}
                label="AI Credits"
                value={summary.balances.ai_credits_balance.toLocaleString()}
                hint={`Granted this period: ${summary.balances.ai_credits_granted_this_period.toLocaleString()} · Consumed: ${summary.balances.ai_credits_consumed_this_period.toLocaleString()}`}
              />
              <BalanceTile
                icon={<Wallet className="h-5 w-5 text-success" />}
                label="Money balance"
                value={`${(summary.balances.money_balance_cents / 100).toFixed(2)} ₴`}
                hint={`Currency: ${summary.balances.currency}`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              💡 To change your plan or top up balance, please contact MARQ support. Self-service billing is coming soon.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
          <CardDescription>Last 50 entries</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          {ledgerQuery.data && ledgerQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Δ</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerQuery.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">{row.kind}</TableCell>
                    <TableCell className={cn(
                      "font-mono text-xs",
                      row.direction === "credit" ? "text-success" : "text-destructive",
                    )}>
                      <span className="inline-flex items-center gap-1">
                        {row.direction === "credit"
                          ? <ArrowUpRight className="h-3 w-3" />
                          : <ArrowDownLeft className="h-3 w-3" />}
                        {row.direction === "credit" ? "+" : "−"}{row.amount.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs">{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
