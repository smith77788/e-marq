/**
 * /admin/decisions — Super-admin Decision Inbox.
 * Перегляд і масова обробка pending decisions з усіх tenants.
 * Фільтри: tenant_id, action_type (owner_setup_task / owner_review / flag_for_review та ін.).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import * as React from "react";
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
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopyButton } from "@/components/admin/CopyButton";
import { AutoApprovalHeatmap } from "@/components/admin/AutoApprovalHeatmap";
import { Sparkline } from "@/components/detail/Sparkline";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Check,
  X,
  RefreshCw,
  Filter,
  Eye,
  Sparkles,
  Download,
  ArrowUpRight,
  ChevronDown,
  Grid3x3,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/decisions")({
  head: () => ({
    meta: [
      { title: "Рішення агентів (адмін) — MARQ" },
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
  insight_id: string | null;
  agent_id: string;
  action_type: string;
  title: string | null;
  rationale: string | null;
  payload: Record<string, unknown> | null;
  expected_impact: Record<string, unknown> | null;
  confidence: number | null;
  status: string;
  requires_approval: boolean | null;
  approved_by_auto: boolean | null;
  executed_at: string | null;
  executor_action_id: string | null;
  created_at: string;
};

type InsightRow = {
  id: string;
  insight_type: string;
  title: string;
  description: string | null;
  expected_impact: string | null;
  confidence: number | null;
  risk_level: string | null;
  status: string;
  metrics: Record<string, unknown> | null;
  created_at: string;
};

type OutcomeRow = {
  id: string;
  action_type: string;
  baseline: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  delta: Record<string, unknown> | null;
  attributed_revenue_cents: number | null;
  success: boolean | null;
  measurement_window: string | null;
  measured_at: string;
  notes: string | null;
};

type TenantOpt = { id: string; name: string; slug: string | null };

function AdminDecisionsPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();

  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [typesFilter, setTypesFilter] = useState<Set<string>>(new Set(DEFAULT_TYPES));
  const [riskFilter, setRiskFilter] = useState<Set<string>>(new Set());
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [riskByInsight, setRiskByInsight] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<Decision | null>(null);
  const [detailInsight, setDetailInsight] = useState<InsightRow | null>(null);
  const [detailOutcome, setDetailOutcome] = useState<OutcomeRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [insightView, setInsightView] = useState<InsightRow | null>(null);

  const openDetail = useCallback(async (d: Decision) => {
    setDetail(d);
    setDetailInsight(null);
    setDetailOutcome(null);
    setDetailLoading(true);
    try {
      const tasks: Promise<void>[] = [];
      if (d.insight_id) {
        tasks.push(
          (async () => {
            const { data } = await supabase
              .from("ai_insights")
              .select(
                "id, insight_type, title, description, expected_impact, confidence, risk_level, status, metrics, created_at",
              )
              .eq("id", d.insight_id!)
              .maybeSingle();
            setDetailInsight((data ?? null) as InsightRow | null);
          })(),
        );
      }
      tasks.push(
        (async () => {
          const { data } = await supabase
            .from("action_outcomes")
            .select(
              "id, action_type, baseline, actual, delta, attributed_revenue_cents, success, measurement_window, measured_at, notes",
            )
            .eq("tenant_id", d.tenant_id)
            .eq("decision_id", d.id)
            .order("measured_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          setDetailOutcome((data ?? null) as OutcomeRow | null);
        })(),
      );
      await Promise.all(tasks);
    } finally {
      setDetailLoading(false);
    }
  }, []);

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
      .select(
        "id, tenant_id, insight_id, agent_id, action_type, title, rationale, payload, expected_impact, confidence, status, requires_approval, approved_by_auto, executed_at, executor_action_id, created_at",
      )
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
    const list = (data ?? []) as Decision[];
    setDecisions(list);
    setSelected(new Set());

    const insightIds = Array.from(
      new Set(list.map((d) => d.insight_id).filter((x): x is string => !!x)),
    );
    if (insightIds.length > 0) {
      const { data: ins } = await supabase
        .from("ai_insights")
        .select("id, risk_level")
        .in("id", insightIds);
      const m = new Map<string, string>();
      for (const r of (ins ?? []) as Array<{ id: string; risk_level: string | null }>) {
        if (r.risk_level) m.set(r.id, r.risk_level);
      }
      setRiskByInsight(m);
    } else {
      setRiskByInsight(new Map());
    }
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

  const filteredDecisions = useMemo(() => {
    const list = decisions ?? [];
    return list.filter((d) => {
      if (minConfidence > 0) {
        const c = d.confidence != null ? Number(d.confidence) : 0;
        if (c * 100 < minConfidence) return false;
      }
      if (riskFilter.size > 0) {
        const r = d.insight_id ? (riskByInsight.get(d.insight_id) ?? "unknown") : "unknown";
        if (!riskFilter.has(r)) return false;
      }
      return true;
    });
  }, [decisions, minConfidence, riskFilter, riskByInsight]);

  const toggleType = (t: string) => {
    setTypesFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleRisk = (r: string) => {
    setRiskFilter((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const toggleAll = () => {
    if (filteredDecisions.length === 0) return;
    if (selected.size === filteredDecisions.length) setSelected(new Set());
    else setSelected(new Set(filteredDecisions.map((d) => d.id)));
  };

  const exportCsv = () => {
    if (filteredDecisions.length === 0) {
      toast.error("Нічого експортувати");
      return;
    }
    const headers = [
      "id",
      "tenant_id",
      "tenant_name",
      "action_type",
      "title",
      "agent_id",
      "status",
      "confidence",
      "risk_level",
      "created_at",
      "age_hours",
      "rationale",
    ];
    const esc = (v: unknown): string => {
      if (v == null) return "";
      const s = typeof v === "string" ? v : String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(",")];
    for (const d of filteredDecisions) {
      const ageHours = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 3_600_000);
      const risk = d.insight_id ? (riskByInsight.get(d.insight_id) ?? "") : "";
      lines.push(
        [
          d.id,
          d.tenant_id,
          tenantNameById.get(d.tenant_id) ?? "",
          d.action_type,
          d.title ?? "",
          d.agent_id,
          d.status,
          d.confidence ?? "",
          risk,
          d.created_at,
          ageHours,
          d.rationale ?? "",
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Експортовано ${filteredDecisions.length} рядків`);
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
          <h1 className="text-2xl font-bold tracking-tight">Рішення агентів · адмін</h1>
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

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Risk level:
            </span>
            <div className="flex flex-wrap gap-2">
              {(["low", "medium", "high", "unknown"] as const).map((r) => {
                const active = riskFilter.has(r);
                return (
                  <Button
                    key={r}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleRisk(r)}
                  >
                    {r}
                  </Button>
                );
              })}
              {riskFilter.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setRiskFilter(new Set())}>
                  Скинути
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Min confidence
              </span>
              <span className="text-xs font-medium">{minConfidence}%</span>
            </div>
            <Slider
              value={[minConfidence]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => setMinConfidence(v[0] ?? 0)}
              className="max-w-md"
            />
          </div>
        </CardContent>
      </Card>

      {decisions && decisions.length > 0 && (
        <Collapsible>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer pb-3 hover:bg-muted/30">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Grid3x3 className="h-4 w-4" /> Auto-approval heatmap
                  <ChevronDown className="ml-auto h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                </CardTitle>
                <CardDescription>
                  action_type × tenant. Зелений = переважно auto-approved, сірий = manual-only.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <AutoApprovalHeatmap decisions={decisions} tenantNameById={tenantNameById} />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">
              Pending: {filteredDecisions.length}
              {decisions && decisions.length !== filteredDecisions.length && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  / {decisions.length}
                </span>
              )}
              {selected.size > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · обрано {selected.size}
                </span>
              )}
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={filteredDecisions.length === 0}
              onClick={exportCsv}
            >
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
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
          ) : filteredDecisions.length === 0 ? (
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
                      checked={
                        selected.size === filteredDecisions.length && filteredDecisions.length > 0
                      }
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Action type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDecisions.map((d) => {
                  const ageHours = Math.floor(
                    (Date.now() - new Date(d.created_at).getTime()) / 3_600_000,
                  );
                  const stale = ageHours >= 24;
                  const isSel = selected.has(d.id);
                  const risk = d.insight_id ? (riskByInsight.get(d.insight_id) ?? null) : null;
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
                      <TableCell className="text-right">
                        {risk ? (
                          <Badge
                            variant={
                              risk === "high"
                                ? "destructive"
                                : risk === "medium"
                                  ? "default"
                                  : "secondary"
                            }
                            className="text-[10px]"
                          >
                            {risk}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {d.confidence != null ? `${Math.round(Number(d.confidence) * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={stale ? "destructive" : "secondary"} className="text-xs">
                          {ageHours < 1 ? "<1г" : `${ageHours}г`}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void openDetail(d)}
                          aria-label="Деталі"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DecisionDetailDialog
        decision={detail}
        insight={detailInsight}
        outcome={detailOutcome}
        loading={detailLoading}
        tenantName={detail ? (tenantNameById.get(detail.tenant_id) ?? null) : null}
        onClose={() => setDetail(null)}
        onApprove={async () => {
          if (!detail) return;
          const { data, error } = await supabase.rpc("owner_approve_decision", {
            _decision_id: detail.id,
          });
          const r = data as { ok?: boolean } | null;
          if (error || !r?.ok) toast.error("Не вдалося схвалити");
          else {
            toast.success("Схвалено");
            setDetail(null);
            void load();
          }
        }}
        onReject={async () => {
          if (!detail) return;
          const { data, error } = await supabase.rpc("owner_reject_decision", {
            _decision_id: detail.id,
            _reason: "admin_dismiss_from_detail",
          });
          const r = data as { ok?: boolean } | null;
          if (error || !r?.ok) toast.error("Не вдалося відхилити");
          else {
            toast.success("Відхилено");
            setDetail(null);
            void load();
          }
        }}
        onOpenInsight={(i) => setInsightView(i)}
      />

      <InsightDetailDialog
        insight={insightView}
        tenantId={detail?.tenant_id ?? null}
        onClose={() => setInsightView(null)}
        onOpenDecision={(d) => {
          setInsightView(null);
          void openDetail(d);
        }}
      />
    </div>
  );
}

/* ---------- Detail dialog ---------- */

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2)} грн`;
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("uk-UA");
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return <p className="text-xs text-muted-foreground italic">Порожньо</p>;
  }
  return (
    <pre className="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DecisionDetailDialog({
  decision,
  insight,
  outcome,
  loading,
  tenantName,
  onClose,
  onApprove,
  onReject,
  onOpenInsight,
}: {
  decision: Decision | null;
  insight: InsightRow | null;
  outcome: OutcomeRow | null;
  loading: boolean;
  tenantName: string | null;
  onClose: () => void;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onOpenInsight: (i: InsightRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!decision) return null;

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!decision} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {decision.title ?? ACTION_TYPE_LABELS[decision.action_type] ?? decision.action_type}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {ACTION_TYPE_LABELS[decision.action_type] ?? decision.action_type}
            </Badge>
            <span>· {tenantName ?? decision.tenant_id.slice(0, 8)}</span>
            <span>· {decision.agent_id}</span>
            <span>· {fmtDate(decision.created_at)}</span>
            {decision.approved_by_auto && <Badge variant="secondary">auto-approved</Badge>}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-5">
            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Confidence"
                value={
                  decision.confidence != null
                    ? `${Math.round(Number(decision.confidence) * 100)}%`
                    : "—"
                }
              />
              <Stat label="Status" value={decision.status} />
              <Stat label="Approval" value={decision.requires_approval ? "manual" : "auto"} />
              <Stat label="Executed" value={decision.executed_at ? "✓" : "—"} />
            </div>

            {/* Rationale */}
            <Section
              title="Причина (rationale)"
              action={
                decision.rationale ? (
                  <CopyButton value={decision.rationale} label="Rationale" />
                ) : null
              }
            >
              {decision.rationale ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{decision.rationale}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">Агент не залишив пояснення.</p>
              )}
            </Section>

            {/* Expected impact */}
            <Section
              title="Очікуваний ефект"
              action={
                decision.expected_impact ? (
                  <CopyButton value={decision.expected_impact} label="Impact" />
                ) : null
              }
            >
              <JsonBlock value={decision.expected_impact} />
            </Section>

            {/* Payload */}
            <Section
              title="Payload (повні параметри дії)"
              action={
                decision.payload ? <CopyButton value={decision.payload} label="Payload" /> : null
              }
            >
              <JsonBlock value={decision.payload} />
            </Section>

            {/* Semantic key (dedup hash) */}
            {(() => {
              const sk = (decision.payload as { semantic_key?: unknown } | null)?.semantic_key;
              if (typeof sk !== "string" || !sk) return null;
              return (
                <Section
                  title="Semantic key (dedup)"
                  action={<CopyButton value={sk} label="Key" />}
                >
                  <code className="block break-all rounded bg-muted/40 p-2 font-mono text-xs">
                    {sk}
                  </code>
                </Section>
              );
            })()}

            {/* Linked insight */}
            <Section title="Пов'язаний insight">
              {loading && !insight ? (
                <Skeleton className="h-20 w-full" />
              ) : insight ? (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{insight.insight_type}</Badge>
                    {insight.risk_level && (
                      <Badge
                        variant={
                          insight.risk_level === "high"
                            ? "destructive"
                            : insight.risk_level === "medium"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {insight.risk_level}
                      </Badge>
                    )}
                    <Badge variant="secondary">{insight.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(insight.created_at)}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{insight.title}</p>
                  {insight.description && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {insight.description}
                    </p>
                  )}
                  {insight.expected_impact && (
                    <p className="text-xs text-muted-foreground">
                      Impact: {insight.expected_impact}
                    </p>
                  )}
                  {insight.metrics && Object.keys(insight.metrics).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Metrics</summary>
                      <JsonBlock value={insight.metrics} />
                    </details>
                  )}
                </div>
              ) : decision.insight_id ? (
                <p className="text-xs text-muted-foreground italic">
                  Insight {decision.insight_id.slice(0, 8)} не знайдений.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Decision створено без insight (manual / SQL pipeline).
                </p>
              )}
            </Section>

            {/* Latest outcome */}
            <Section title="Останній outcome">
              {loading && !outcome ? (
                <Skeleton className="h-20 w-full" />
              ) : outcome ? (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        outcome.success === true
                          ? "default"
                          : outcome.success === false
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {outcome.success === true
                        ? "win"
                        : outcome.success === false
                          ? "loss"
                          : "neutral"}
                    </Badge>
                    {outcome.measurement_window && (
                      <Badge variant="outline">{outcome.measurement_window}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(outcome.measured_at)}
                    </span>
                  </div>
                  <p className="text-sm">
                    Attributed revenue:{" "}
                    <span className="font-medium">
                      {fmtMoney(outcome.attributed_revenue_cents)}
                    </span>
                  </p>
                  {outcome.notes && (
                    <p className="text-xs text-muted-foreground">{outcome.notes}</p>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Baseline / Actual / Delta
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <div>
                        <p className="text-xs font-medium">Baseline</p>
                        <JsonBlock value={outcome.baseline} />
                      </div>
                      <div>
                        <p className="text-xs font-medium">Actual</p>
                        <JsonBlock value={outcome.actual} />
                      </div>
                      <div>
                        <p className="text-xs font-medium">Delta</p>
                        <JsonBlock value={outcome.delta} />
                      </div>
                    </div>
                  </details>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Outcome ще не виміряний (measurement_loop запускається кожні 6г, ≥24г після
                  виконання).
                </p>
              )}
            </Section>

            <div className="text-xs text-muted-foreground">
              ID: <code>{decision.id}</code>
              {decision.executor_action_id && (
                <>
                  {" · "}executor_action: <code>{decision.executor_action_id}</code>
                </>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          {insight && (
            <Button variant="outline" size="sm" onClick={() => onOpenInsight(insight)}>
              <Sparkles className="mr-1 h-4 w-4" /> Переглянути insight
            </Button>
          )}
          {decision.status === "pending" && (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void wrap(onReject)}
              >
                <X className="mr-1 h-4 w-4" /> Відхилити
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void wrap(onApprove)}>
                <Check className="mr-1 h-4 w-4" /> Схвалити
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Insight detail dialog ---------- */

function InsightDetailDialog({
  insight,
  tenantId,
  onClose,
  onOpenDecision,
}: {
  insight: InsightRow | null;
  tenantId: string | null;
  onClose: () => void;
  onOpenDecision: (d: Decision) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [trend, setTrend] = useState<{ label: string; data: number[] } | null>(null);

  useEffect(() => {
    if (!insight || !tenantId) return;
    setLoading(true);
    void (async () => {
      const { data: decs } = await supabase
        .from("decision_queue")
        .select(
          "id, tenant_id, insight_id, agent_id, action_type, title, rationale, payload, expected_impact, confidence, status, requires_approval, approved_by_auto, executed_at, executor_action_id, created_at",
        )
        .eq("insight_id", insight.id)
        .order("created_at", { ascending: false });
      const decList = (decs ?? []) as Decision[];
      setDecisions(decList);

      const decIds = decList.map((d) => d.id);
      if (decIds.length > 0) {
        const { data: outs } = await supabase
          .from("action_outcomes")
          .select(
            "id, action_type, baseline, actual, delta, attributed_revenue_cents, success, measurement_window, measured_at, notes",
          )
          .in("decision_id", decIds)
          .order("measured_at", { ascending: false });
        setOutcomes((outs ?? []) as OutcomeRow[]);
      } else {
        setOutcomes([]);
      }
      setLoading(false);
    })();

    // 7d sparkline trend (best-effort, fails silently)
    void (async () => {
      setTrend(null);
      const m = (insight.metrics ?? {}) as Record<string, unknown>;
      const productId = typeof m.product_id === "string" ? m.product_id : null;
      const customerId = typeof m.customer_id === "string" ? m.customer_id : null;
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      try {
        const sb = supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              eq: (
                a: string,
                b: string,
              ) => {
                eq: (
                  a: string,
                  b: string,
                ) => {
                  gte: (
                    a: string,
                    b: string,
                  ) => {
                    order: (
                      a: string,
                      o: { ascending: boolean },
                    ) => Promise<{
                      data: Array<{ revenue_cents: number | null }> | null;
                    }>;
                  };
                };
              };
            };
          };
        };
        if (productId) {
          const { data } = await sb
            .from("product_metrics_daily")
            .select("day, revenue_cents, units_sold")
            .eq("tenant_id", tenantId)
            .eq("product_id", productId)
            .gte("day", since)
            .order("day", { ascending: true });
          const rows = data ?? [];
          if (rows.length > 1)
            setTrend({
              label: "Revenue (7d)",
              data: rows.map((r) => Number(r.revenue_cents ?? 0) / 100),
            });
        } else if (customerId) {
          const { data } = await sb
            .from("customer_metrics_daily")
            .select("day, revenue_cents")
            .eq("tenant_id", tenantId)
            .eq("customer_id", customerId)
            .gte("day", since)
            .order("day", { ascending: true });
          const rows = data ?? [];
          if (rows.length > 1)
            setTrend({
              label: "Customer revenue (7d)",
              data: rows.map((r) => Number(r.revenue_cents ?? 0) / 100),
            });
        }
      } catch {
        /* ignore */
      }
    })();
  }, [insight, tenantId]);

  if (!insight) return null;

  return (
    <Dialog open={!!insight} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-6 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {insight.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{insight.insight_type}</Badge>
            {insight.risk_level && (
              <Badge
                variant={
                  insight.risk_level === "high"
                    ? "destructive"
                    : insight.risk_level === "medium"
                      ? "default"
                      : "secondary"
                }
              >
                risk: {insight.risk_level}
              </Badge>
            )}
            <Badge variant="secondary">{insight.status}</Badge>
            <span>· {fmtDate(insight.created_at)}</span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Confidence"
                value={
                  insight.confidence != null
                    ? `${Math.round(Number(insight.confidence) * 100)}%`
                    : "—"
                }
              />
              <Stat label="Type" value={insight.insight_type} />
              <Stat label="Risk" value={insight.risk_level ?? "—"} />
              <Stat label="Decisions" value={String(decisions.length)} />
            </div>

            {insight.description && (
              <Section title="Опис">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{insight.description}</p>
              </Section>
            )}

            {insight.expected_impact && (
              <Section title="Очікуваний ефект">
                <p className="text-sm">{insight.expected_impact}</p>
              </Section>
            )}

            {trend && trend.data.length > 1 && (
              <Section title={trend.label}>
                <div className="rounded-md border bg-card p-3">
                  <Sparkline data={trend.data} />
                </div>
              </Section>
            )}

            <Section
              title="Метрики (full payload)"
              action={
                insight.metrics ? <CopyButton value={insight.metrics} label="Metrics" /> : null
              }
            >
              <JsonBlock value={insight.metrics} />
            </Section>

            <Section title={`Породжені decisions (${decisions.length})`}>
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : decisions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Жодного decision на основі цього insight.
                </p>
              ) : (
                <div className="space-y-2">
                  {decisions.map((d) => (
                    <button
                      type="button"
                      key={d.id}
                      onClick={() => onOpenDecision(d)}
                      className="w-full rounded-md border p-2 text-left text-xs transition-colors hover:bg-muted/50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {ACTION_TYPE_LABELS[d.action_type] ?? d.action_type}
                        </Badge>
                        <Badge variant="secondary">{d.status}</Badge>
                        {d.approved_by_auto && <Badge variant="default">auto</Badge>}
                        <span className="text-muted-foreground">{fmtDate(d.created_at)}</span>
                        <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      {d.title && <p className="mt-1 text-sm">{d.title}</p>}
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Пов'язані outcomes (${outcomes.length})`}>
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : outcomes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Outcomes ще не виміряні.</p>
              ) : (
                <div className="space-y-2">
                  {outcomes.map((o) => (
                    <div key={o.id} className="rounded-md border p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            o.success === true
                              ? "default"
                              : o.success === false
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {o.success === true ? "win" : o.success === false ? "loss" : "neutral"}
                        </Badge>
                        {o.measurement_window && (
                          <Badge variant="outline">{o.measurement_window}</Badge>
                        )}
                        <span className="text-muted-foreground">{fmtDate(o.measured_at)}</span>
                        <span>· {fmtMoney(o.attributed_revenue_cents)}</span>
                      </div>
                      {o.notes && <p className="mt-1 text-muted-foreground">{o.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <div className="text-xs text-muted-foreground">
              ID: <code>{insight.id}</code>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium truncate">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
