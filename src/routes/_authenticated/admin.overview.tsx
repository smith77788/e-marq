/**
 * Cross-tenant overview for super-admin.
 * Real-time table of all tenants with plan, usage, balances, alerts.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { AlertCircle, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlanBadge } from "@/components/admin/PlanBadge";

export const Route = createFileRoute("/_authenticated/admin/overview")({
  component: AdminOverviewPage,
});

type Row = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  status: string;
  plan_key: string;
  plan_name: string;
  subscription_status: string;
  ai_credits_balance: number;
  money_balance_cents: number;
  ai_runs_this_period: number;
  orders_this_period: number;
  products_count: number;
  customers_count: number;
  created_at: string;
};

function AdminOverviewPage() {
  const { isSuperAdmin, loading } = useAuth();
  const [search, setSearch] = useState("");

  const overviewQuery = useQuery({
    queryKey: ["all-tenants-overview"],
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_tenants_overview");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(() => {
    const rows = overviewQuery.data ?? [];
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      r.tenant_name.toLowerCase().includes(q)
      || r.tenant_slug.toLowerCase().includes(q)
      || r.plan_key.includes(q),
    );
  }, [overviewQuery.data, search]);

  const totals = useMemo(() => {
    const rows = overviewQuery.data ?? [];
    return {
      tenants: rows.length,
      lowCredits: rows.filter((r) => r.ai_credits_balance < 50).length,
      suspended: rows.filter((r) => r.subscription_status === "suspended" || r.subscription_status === "cancelled").length,
      orders: rows.reduce((sum, r) => sum + Number(r.orders_this_period ?? 0), 0),
    };
  }, [overviewQuery.data]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader><CardTitle>Access denied</CardTitle></CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cross-tenant overview</h1>
        <p className="text-sm text-muted-foreground">
          Plans, balances, usage and health across all tenants. Auto-refreshes every 30s.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatBlock label="Tenants" value={totals.tenants} />
        <StatBlock label="Low credits (&lt;50)" value={totals.lowCredits} accent={totals.lowCredits > 0 ? "warning" : undefined} />
        <StatBlock label="Suspended/cancelled" value={totals.suspended} accent={totals.suspended > 0 ? "danger" : undefined} />
        <StatBlock label="Orders this period" value={totals.orders.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>All tenants</CardTitle>
              <CardDescription>{filtered.length} of {overviewQuery.data?.length ?? 0}</CardDescription>
            </div>
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-8 pl-7 text-xs" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Sub</TableHead>
                <TableHead className="text-right">AI credits</TableHead>
                <TableHead className="text-right">Money</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">Customers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const lowCredits = r.ai_credits_balance < 50;
                return (
                  <TableRow key={r.tenant_id}>
                    <TableCell>
                      <Link
                        to="/admin/tenants/$tenantId"
                        params={{ tenantId: r.tenant_id }}
                        className="font-medium hover:underline"
                      >
                        {r.tenant_name}
                      </Link>
                      <div className="font-mono text-[10px] text-muted-foreground">/{r.tenant_slug}</div>
                    </TableCell>
                    <TableCell><PlanBadge planKey={r.plan_key} planName={r.plan_name} /></TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{r.subscription_status}</Badge>
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${lowCredits ? "text-warning font-semibold" : ""}`}>
                      {lowCredits && <AlertCircle className="mr-1 inline h-3 w-3" />}
                      {r.ai_credits_balance.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ${(r.money_balance_cents / 100).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{Number(r.ai_runs_this_period).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{Number(r.orders_this_period).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{Number(r.products_count).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{Number(r.customers_count).toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: number | string; accent?: "warning" | "danger" }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${
          accent === "warning" ? "text-warning"
          : accent === "danger" ? "text-destructive"
          : "text-foreground"
        }`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
