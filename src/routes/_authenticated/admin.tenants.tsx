/**
 * Super-admin tenants list.
 * Uses `get_all_tenants_overview` so super-admin sees plan, balances and usage
 * for every tenant in one shot. Includes inline status switcher and quick deep-link
 * into tenant details.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Search, Building2, ExternalLink, Zap } from "lucide-react";
import {
  TenantQuickActionsDialog,
  type QuickActionsTenant,
} from "@/components/admin/TenantQuickActionsDialog";
import { PendingTenantsCard } from "@/components/admin/PendingTenantsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { PlanBadge } from "@/components/admin/PlanBadge";

export const Route = createFileRoute("/_authenticated/admin/tenants")({
  component: AdminTenantsPage,
});

type OverviewRow = {
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

const STATUS_LABEL: Record<string, string> = {
  active: "активний",
  suspended: "призупинено",
  inactive: "вимкнено",
};

const SUB_LABEL: Record<string, string> = {
  trial: "пробний",
  active: "активний",
  past_due: "прострочено",
  suspended: "призупинено",
  cancelled: "скасовано",
  no_plan: "без тарифу",
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function AdminTenantsPage() {
  const { isSuperAdmin, loading, user } = useAuth();
  const { has } = useAdminCapabilities();
  const canChangeStatus = has("change_status");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [quickTarget, setQuickTarget] = useState<QuickActionsTenant | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["all-tenants-overview"],
    enabled: isSuperAdmin,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_tenants_overview");
      if (error) throw error;
      return (data ?? []) as OverviewRow[];
    },
  });

  const createTenant = useMutation({
    mutationFn: async (input: { name: string; slug: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("tenants")
        .insert({ name: input.name, slug: input.slug, owner_user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Бренд створено");
      setName("");
      setSlug("");
      setSlugTouched(false);
      void qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
      void qc.invalidateQueries({ queryKey: ["my-tenants"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Не вдалося створити бренд"),
  });

  const setStatus = useMutation({
    mutationFn: async ({ tenantId, status }: { tenantId: string; status: string }) => {
      const { error } = await supabase.rpc("admin_set_tenant_status", {
        _tenant_id: tenantId,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Статус оновлено");
      void qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const rows = overviewQuery.data ?? [];
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.tenant_name.toLowerCase().includes(q) ||
        r.tenant_slug.toLowerCase().includes(q) ||
        r.plan_key.includes(q),
    );
  }, [overviewQuery.data, search]);

  if (loading) return <PageSkeleton blocks={3} />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalSlug = (slug || slugify(name)).trim();
    if (!name.trim() || !finalSlug) {
      toast.error("Назва та коротке імʼя обовʼязкові");
      return;
    }
    createTenant.mutate({ name: name.trim(), slug: finalSlug });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
          Усі бренди платформи
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Бренди</h1>
        <p className="text-sm text-muted-foreground">
          Тарифи, баланси, навантаження — оновлюється кожну хвилину.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Створити бренд</CardTitle>
          <CardDescription>
            Власником стаєте ви. Базові налаштування створюються автоматично.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="name">Назва бренду</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme Coffee"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Коротке імʼя в адресі</Label>
              <Input
                id="slug"
                required
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="acme-coffee"
              />
            </div>
            <Button type="submit" disabled={createTenant.isPending}>
              {createTenant.isPending ? "Створюю…" : "Створити"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Усі бренди
              </CardTitle>
              <CardDescription>
                {filtered.length} з {overviewQuery.data?.length ?? 0}
              </CardDescription>
            </div>
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук за назвою, адресою, тарифом…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {overviewQuery.isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Бренд</TableHead>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Підписка</TableHead>
                    <TableHead className="text-right">AI-кредити</TableHead>
                    <TableHead className="text-right">Баланс ₴</TableHead>
                    <TableHead className="text-right">Замовлень</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Дії</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.tenant_id}>
                      <TableCell>
                        <Link
                          to="/admin/tenants/$tenantId"
                          params={{ tenantId: t.tenant_id }}
                          className="font-medium hover:underline"
                        >
                          {t.tenant_name}
                        </Link>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          /{t.tenant_slug}
                        </div>
                      </TableCell>
                      <TableCell>
                        <PlanBadge planKey={t.plan_key} planName={t.plan_name} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {SUB_LABEL[t.subscription_status] ?? t.subscription_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(t.ai_credits_balance).toLocaleString("uk-UA")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {(Number(t.money_balance_cents) / 100).toLocaleString("uk-UA", {
                          maximumFractionDigits: 0,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(t.orders_this_period).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={t.status}
                          onValueChange={(v) =>
                            v !== t.status && setStatus.mutate({ tenantId: t.tenant_id, status: v })
                          }
                          disabled={setStatus.isPending || !canChangeStatus}
                        >
                          <SelectTrigger className="h-7 w-32 text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">{STATUS_LABEL.active}</SelectItem>
                            <SelectItem value="suspended">{STATUS_LABEL.suspended}</SelectItem>
                            <SelectItem value="inactive">{STATUS_LABEL.inactive}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setQuickTarget({
                                tenant_id: t.tenant_id,
                                tenant_name: t.tenant_name,
                                tenant_slug: t.tenant_slug,
                                status: t.status,
                                plan_key: t.plan_key,
                                plan_name: t.plan_name,
                              })
                            }
                          >
                            <Zap className="mr-1 h-3 w-3" />
                            Дії
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              to="/admin/tenants/$tenantId"
                              params={{ tenantId: t.tenant_id }}
                            >
                              Деталі
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {search
                ? "Нічого не знайдено за цим запитом."
                : "Поки що брендів немає. Створіть перший вище."}
            </p>
          )}
        </CardContent>
      </Card>

      <TenantQuickActionsDialog
        tenant={quickTarget}
        open={!!quickTarget}
        onOpenChange={(v) => !v && setQuickTarget(null)}
      />
    </div>
  );
}
