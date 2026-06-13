/**
 * /brand/decisions — Owner Decision Inbox.
 * Сюди ведуть Telegram-нотифікації про pending decisions, які потребують
 * рішення власника (owner_setup_task / owner_review / flag_for_review).
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Check,
  X,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SKIP_REASON_LABELS: Record<string, { label: string; hint: string }> = {
  high_value_low_confidence: {
    label: "Високий ризик",
    hint: "Очікуваний дохід > 500 ₴, але впевненість прогнозу < 40% — потрібне ваше рішення.",
  },
  daily_cap_reached: {
    label: "Денний ліміт",
    hint: "AI вже виконав 20 авто-дій за добу. Решта — на ваш розгляд.",
  },
};

type Decision = {
  id: string;
  tenant_id: string;
  agent_id: string;
  action_type: string;
  title: string | null;
  rationale: string | null;
  payload: Record<string, unknown> | null;
  confidence: number | null;
  expected_impact: Record<string, unknown> | null;
  created_at: string;
};

type Search = { tenant?: string };

const ACTION_TYPE_LABELS: Record<string, string> = {
  owner_setup_task: "Налаштування магазину",
  owner_review: "Потребує перегляду",
  flag_for_review: "Помічено для розгляду",
  feature_product: "Виділити товар",
  cross_sell_recommend: "Крос-продаж",
  request_review: "Запит відгуку",
};

export const Route = createFileRoute("/_authenticated/brand/decisions")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Рішення агентів — MARQ" },
      {
        name: "description",
        content: "Pending рішення AI-агентів, які потребують вашого підтвердження",
      },
    ],
  }),
  component: DecisionsPage,
});

function DecisionsPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/decisions" });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();

  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Бренд не обрано</CardTitle>
          <CardDescription>Спочатку створіть або оберіть бренд.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/brand">← Назад</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Рішення агентів</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Рішення AI-агентів, які потребують вашого підтвердження. Auto-approval уже виконує
          перевірені дії — тут ви бачите тільки те, що вимагає вашої уваги.
        </p>
      </div>
      <DecisionList tenantId={tenantId} />
    </div>
  );
}

function DecisionList({ tenantId }: { tenantId: string }) {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [pendingBulkReject, setPendingBulkReject] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("decision_queue")
      .select(
        "id, tenant_id, agent_id, action_type, title, rationale, payload, confidence, expected_impact, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Не вдалося завантажити: " + error.message);
      setDecisions([]);
      return;
    }
    setDecisions((data ?? []) as Decision[]);
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    const { data, error } = await supabase.rpc("owner_approve_decision", { _decision_id: id });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as { ok: boolean; error?: string } | null;
    if (result?.ok) {
      toast.success("Схвалено");
      setDecisions((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } else {
      toast.error(result?.error ?? "Помилка");
    }
  };

  const reject = async (id: string, reason: string) => {
    setBusyId(id);
    const { data, error } = await supabase.rpc("owner_reject_decision", {
      _decision_id: id,
      _reason: reason || undefined,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as { ok: boolean; error?: string } | null;
    if (result?.ok) {
      toast.success("Відхилено");
      setDecisions((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } else {
      toast.error(result?.error ?? "Помилка");
    }
  };

  const bulkReject = async (actionType: string) => {
    setBulkBusy(actionType);
    const { data, error } = await supabase.rpc("owner_bulk_reject_decisions", {
      _tenant_id: tenantId,
      _action_type: actionType,
      _reason: "bulk_dismiss",
    });
    setBulkBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as { ok: boolean; count?: number; error?: string } | null;
    if (result?.ok) {
      toast.success(`Відхилено: ${result.count ?? 0}`);
      setDecisions((prev) => prev?.filter((d) => d.action_type !== actionType) ?? null);
    } else {
      toast.error(result?.error ?? "Помилка");
    }
  };

  const groups = useMemo(() => {
    if (!decisions) return null;
    const map = new Map<string, Decision[]>();
    for (const d of decisions) {
      const key = d.action_type;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    // sort items within each group by forecast.expected_revenue_cents desc
    for (const [, items] of map) {
      items.sort((a, b) => {
        const av = Number(
          (a.payload as { forecast?: { expected_revenue_cents?: number } } | null)?.forecast
            ?.expected_revenue_cents ?? 0,
        );
        const bv = Number(
          (b.payload as { forecast?: { expected_revenue_cents?: number } } | null)?.forecast
            ?.expected_revenue_cents ?? 0,
        );
        return bv - av;
      });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [decisions]);

  if (decisions === null || groups === null) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (decisions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Check className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Немає pending рішень. Усе під контролем — AI працює автономно.
          </p>
        </CardContent>
      </Card>
    );
  }

  const visibleGroups = filter ? groups.filter(([k]) => k === filter) : groups;

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={filter === null ? "default" : "outline"}
          onClick={() => setFilter(null)}
        >
          Усі ({decisions.length})
        </Button>
        {groups.map(([type, items]) => (
          <Button
            key={type}
            size="sm"
            variant={filter === type ? "default" : "outline"}
            onClick={() => setFilter(type)}
          >
            {ACTION_TYPE_LABELS[type] ?? type} ({items.length})
          </Button>
        ))}
      </div>

      {/* Grouped lists */}
      {visibleGroups.map(([type, items]) => {
        const collapsed = collapsedGroups[type] ?? items.length > 5;
        return (
          <Card key={type}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 text-left"
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, [type]: !collapsed }))}
                >
                  {collapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  <CardTitle className="text-sm font-semibold">
                    {ACTION_TYPE_LABELS[type] ?? type}
                  </CardTitle>
                  <Badge variant="secondary">{items.length}</Badge>
                </button>
                {items.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bulkBusy === type}
                    onClick={() => setPendingBulkReject(type)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Відхилити всі
                  </Button>
                )}
              </div>
            </CardHeader>
            {!collapsed && (
              <CardContent className="space-y-2 pt-0">
                {items.map((d) => (
                  <DecisionCard
                    key={d.id}
                    decision={d}
                    busy={busyId === d.id}
                    onApprove={() => approve(d.id)}
                    onReject={(reason) => reject(d.id, reason)}
                  />
                ))}
              </CardContent>
            )}
          </Card>
        );
      })}

      <AlertDialog
        open={pendingBulkReject !== null}
        onOpenChange={(open) => !open && setPendingBulkReject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Відхилити всі рішення цього типу?</AlertDialogTitle>
            <AlertDialogDescription>
              Всі pending рішення типу «
              {pendingBulkReject
                ? (ACTION_TYPE_LABELS[pendingBulkReject] ?? pendingBulkReject)
                : ""}
              » будуть відхилені. Цю дію не можна скасувати.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const type = pendingBulkReject;
                setPendingBulkReject(null);
                if (type) void bulkReject(type);
              }}
            >
              Відхилити всі
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const BASIS_LABELS: Record<string, string> = {
  tenant_history: "ваша історія",
  blended: "ваша історія + бенчмарк",
  global_prior: "бенчмарк індустрії",
  global_history: "бенчмарк індустрії",
  heuristic: "початкова оцінка",
  prior: "початкова оцінка",
  bootstrap: "початкова оцінка",
};

const FORECAST_SKIP_LABELS: Record<string, string> = {
  high_value_low_confidence: "Висока сума × низька впевненість — потрібен ручний апрув",
  forecast_uncalibrated: "Прогноз ще не відкалібрований — чекаємо більше вимірювань",
  margin_below_target: "Знижка пробиває мінімальну маржу",
  daily_cap_reached: "Денний ліміт авто-апрувів вичерпано",
};

function ForecastBlock({ payload }: { payload: Record<string, unknown> | null }) {
  const forecast = (payload?.forecast ?? null) as {
    expected_revenue_cents?: number;
    confidence?: number;
    basis?: string;
    source?: string;
    tenant_samples?: number;
    sample_size?: number;
  } | null;
  const skipReason = (payload?.auto_approval_skip_reason as string | undefined) ?? undefined;
  if (!forecast && !skipReason) return null;

  const cents = forecast?.expected_revenue_cents ?? 0;
  const uah = (cents / 100).toLocaleString("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  });
  const confPct = Math.round((forecast?.confidence ?? 0) * 100);
  const basisKey = forecast?.basis ?? forecast?.source ?? "prior";
  const basisLabel = BASIS_LABELS[basisKey] ?? basisKey;
  const n = forecast?.tenant_samples ?? forecast?.sample_size;

  return (
    <div className="space-y-2">
      {forecast && cents > 0 && (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">Очікуваний дохід (30д)</span>
            <span className="text-base font-semibold text-primary">{uah}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Впевненість: {confPct}%</span>
            <span>
              Базис: {basisLabel}
              {n ? ` · n=${n}` : ""}
            </span>
          </div>
        </div>
      )}
      {skipReason && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          ⏸{" "}
          {FORECAST_SKIP_LABELS[skipReason] ?? SKIP_REASON_LABELS[skipReason]?.label ?? skipReason}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  decision: d,
  busy,
  onApprove,
  onReject,
}: {
  decision: Decision;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const ageHours = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 3_600_000);
  const stale = ageHours >= 24;

  return (
    <Card className={stale ? "border-amber-500/40" : "border-border/60"}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{d.title ?? d.action_type}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{d.agent_id}</span>
              {d.confidence != null && (
                <span className="text-muted-foreground">
                  · довіра {Math.round(Number(d.confidence) * 100)}%
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(() => {
              const skip = (d.payload as { auto_approval_skip_reason?: string } | null)
                ?.auto_approval_skip_reason;
              const meta = skip ? SKIP_REASON_LABELS[skip] : null;
              if (!meta) return null;
              return (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400"
                  title={meta.hint}
                >
                  <ShieldAlert className="h-3 w-3" />
                  {meta.label}
                </Badge>
              );
            })()}
            <Badge variant={stale ? "destructive" : "secondary"} className="gap-1">
              {stale ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {ageHours < 1 ? "<1 год" : `${ageHours} год тому`}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {d.rationale && <p className="text-sm">{d.rationale}</p>}
        <ForecastBlock payload={d.payload} />

        {showReject ? (
          <div className="space-y-2">
            <Textarea
              placeholder="Причина відхилення (опціонально)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => onReject(reason)}
              >
                Підтвердити відхилення
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>
                Скасувати
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={onApprove}>
              <Check className="mr-1 h-4 w-4" /> Схвалити
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowReject(true)}>
              <X className="mr-1 h-4 w-4" /> Відхилити
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
