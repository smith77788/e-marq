/**
 * Cross-tenant overview for super-admin.
 * Real-time table of all tenants with plan, usage, balances, alerts.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
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
      suspended: rows.filter((r) => r.subscription_status === "suspended" || r.subscription_status === "cancelled").length,
      orders: rows.reduce((sum, r) => sum + Number(r.orders_this_period ?? 0), 0),
      runs: rows.reduce((sum, r) => sum + Number(r.ai_runs_this_period ?? 0), 0),
    };
  }, [overviewQuery.data]);

  if (loading) return <p className="text-sm text-muted-foreground">Завантаження…</p>;
  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader><CardTitle>Доступ заборонено</CardTitle></CardHeader>
      </Card>
    );
  }

  const SUB_LABEL: Record<string, string> = {
    trial: "пробний",
    active: "активний",
    past_due: "прострочено",
    suspended: "призупинено",
    cancelled: "скасовано",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Огляд по всіх брендах</h1>
        <p className="text-sm text-muted-foreground">
          Тарифи, баланси, навантаження і стан усіх брендів. Оновлюється автоматично кожні 30 секунд.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatBlock label="Брендів" value={totals.tenants} />
        <StatBlock label="Призупинено / скасовано" value={totals.suspended} accent={totals.suspended > 0 ? "danger" : undefined} />
        <StatBlock label="Замовлень за період" value={totals.orders.toLocaleString("uk-UA")} />
        <StatBlock label="Запусків ШІ за період" value={totals.runs.toLocaleString("uk-UA")} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Усі бренди</CardTitle>
              <CardDescription>{filtered.length} з {overviewQuery.data?.length ?? 0}</CardDescription>
            </div>
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Пошук…" className="h-8 pl-7 text-xs" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Бренд</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Підписка</TableHead>
                <TableHead className="text-right">Запусків ШІ</TableHead>
                <TableHead className="text-right">Замовлень</TableHead>
                <TableHead className="text-right">Товарів</TableHead>
                <TableHead className="text-right">Клієнтів</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
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
                    <Badge variant="outline" className="text-[10px]">{SUB_LABEL[r.subscription_status] ?? r.subscription_status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number(r.ai_runs_this_period).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number(r.orders_this_period).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number(r.products_count).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number(r.customers_count).toLocaleString()}</TableCell>
                </TableRow>
              ))}
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
