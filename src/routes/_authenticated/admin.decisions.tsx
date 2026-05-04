/**
 * /admin/decisions — Super-admin Decision Inbox.
 * Перегляд і масова обробка pending decisions з усіх tenants.
 * Фільтри: tenant_id, action_type (owner_setup_task / owner_review / flag_for_review та ін.).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Check, X, RefreshCw, Filter, Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/decisions")({
  head: () => ({
    meta: [
      { title: "Decision Inbox (admin) — MARQ" },
      { name: "description", content: "Cross-tenant pending decisions для super-admin" },
    ],
  }),
  component: AdminDecisionsPage,
});

const ACTION_TYPE_LABELS: Record<string, string> = {
  owner_setup_task: "Налаштування магазину",
  owner_review: "Потребує перегляду",
  owner_review_rules: "Перегляд правил",
  flag_for_review: "Помічено для розгляду",
  feature_product: "Виділити товар",
  cross_sell_recommend: "Cross-sell",
  request_review: "Запит відгуку",
};

const DEFAULT_TYPES = ["owner_setup_task", "owner_review", "flag_for_review"];

type Decision = {
  id: string;
  tenant_id: string;
  agent_id: string;
  action_type: string;
  title: string | null;
  rationale: string | null;
  confidence: number | null;
  created_at: string;
};

type TenantOpt = { id: string; name: string; slug: string | null };

function AdminDecisionsPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();

  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [typesFilter, setTypesFilter] = useState<Set<string>>(new Set(DEFAULT_TYPES));
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load tenants for filter dropdown
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, name, slug")
        .order("name", { ascending: true });
      setTenants((data ?? []) as TenantOpt[]);
    })();
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    let q = supabase
      .from("decision_queue")
      .select("id, tenant_id, agent_id, action_type, title, rationale, confidence, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(500);
    if (tenantFilter !== "all") q = q.eq("tenant_id", tenantFilter);
    if (typesFilter.size > 0) q = q.in("action_type", Array.from(typesFilter));
    const { data, error } = await q;
    setRefreshing(false);
    if (error) {
      toast.error("Не вдалося завантажити: " + error.message);
      return;
    }
    setDecisions((data ?? []) as Decision[]);
    setSelected(new Set());
  }, [tenantFilter, typesFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const tenantNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tenants) m.set(t.id, t.name ?? t.slug ?? t.id.slice(0, 8));
    return m;
  }, [tenants]);

  const allTypes = useMemo(() => {
    const set = new Set<string>(DEFAULT_TYPES);
    for (const d of decisions ?? []) set.add(d.action_type);
    return Array.from(set).sort();
  }, [decisions]);

  const toggleType = (t: string) => {
    setTypesFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleAll = () => {
    if (!decisions) return;
    if (selected.size === decisions.length) setSelected(new Set());
    else setSelected(new Set(decisions.map((d) => d.id)));
  };

  const bulkApprove = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Схвалити ${selected.size} рішень?`)) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      const { data, error } = await supabase.rpc("owner_approve_decision", {
        _decision_id: id,
      });
      const result = data as { ok?: boolean } | null;
      if (error || !result?.ok) fail++;
      else ok++;
    }
    setBusy(false);
    toast.success(`Схвалено: ${ok}${fail ? ` · помилок: ${fail}` : ""}`);
    void load();
  };

  const bulkReject = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Відхилити ${selected.size} рішень?`)) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      const { data, error } = await supabase.rpc("owner_reject_decision", {
        _decision_id: id,
        _reason: "admin_bulk_dismiss",
      });
      const result = data as { ok?: boolean } | null;
      if (error || !result?.ok) fail++;
      else ok++;
    }
    setBusy(false);
    toast.success(`Відхилено: ${ok}${fail ? ` · помилок: ${fail}` : ""}`);
    void load();
  };

  if (authLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!isSuperAdmin) {
    return <Navigate to="/brand" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Decision Inbox · admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pending рішення з усіх tenants. Фільтруй за брендом / типом і обробляй масово.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Оновити
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4" /> Фільтри
          </CardTitle>
          <CardDescription>Обери tenant і типи дій. За замовчуванням — owner_*.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Tenant:</span>
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Усі tenants</SelectItem>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name ?? t.slug ?? t.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Action type:
            </span>
            <div className="flex flex-wrap gap-2">
              {allTypes.map((t) => {
                const active = typesFilter.has(t);
                return (
                  <Button
                    key={t}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleType(t)}
                  >
                    {ACTION_TYPE_LABELS[t] ?? t}
                  </Button>
                );
              })}
              <Button size="sm" variant="ghost" onClick={() => setTypesFilter(new Set())}>
                Скинути
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">
              Pending: {decisions?.length ?? 0}
              {selected.size > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · обрано {selected.size}
                </span>
              )}
            </CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || selected.size === 0}
              onClick={() => void bulkApprove()}
            >
              <Check className="mr-1 h-4 w-4" /> Схвалити
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || selected.size === 0}
              onClick={() => void bulkReject()}
            >
              <X className="mr-1 h-4 w-4" /> Відхилити
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {decisions === null ? (
            <div className="p-6">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : decisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Check className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Немає pending рішень за обраними фільтрами.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === decisions.length && decisions.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Action type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d) => {
                  const ageHours = Math.floor(
                    (Date.now() - new Date(d.created_at).getTime()) / 3_600_000,
                  );
                  const stale = ageHours >= 24;
                  const isSel = selected.has(d.id);
                  return (
                    <TableRow key={d.id} data-state={isSel ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={(v) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(d.id);
                              else next.delete(d.id);
                              return next;
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {tenantNameById.get(d.tenant_id) ?? d.tenant_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ACTION_TYPE_LABELS[d.action_type] ?? d.action_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate" title={d.title ?? ""}>
                        {d.title ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{d.agent_id}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {d.confidence != null ? `${Math.round(Number(d.confidence) * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={stale ? "destructive" : "secondary"} className="text-xs">
                          {ageHours < 1 ? "<1г" : `${ageHours}г`}
                        </Badge>
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
