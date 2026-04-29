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
import { Check, X, Clock, AlertCircle, ChevronDown, ChevronRight, Trash2 } from "lucide-react";

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
  cross_sell_recommend: "Cross-sell",
  request_review: "Запит відгуку",
};

export const Route = createFileRoute("/_authenticated/brand/decisions")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Decision Inbox — MARQ" },
      { name: "description", content: "Pending рішення AI-агентів, які потребують вашого підтвердження" },
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
          <Button asChild><Link to="/brand">← Назад</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Decision Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Рішення AI-агентів, які потребують вашого підтвердження. Auto-approval
          уже виконує перевірені дії — тут ви бачите тільки те, що вимагає вашої уваги.
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

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("decision_queue")
      .select("id, tenant_id, agent_id, action_type, title, rationale, payload, confidence, expected_impact, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Не вдалося завантажити: " + error.message);
      return;
    }
    setDecisions((data ?? []) as Decision[]);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    const { data, error } = await supabase.rpc("owner_approve_decision", { _decision_id: id });
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
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
    if (error) { toast.error(error.message); return; }
    const result = data as { ok: boolean; error?: string } | null;
    if (result?.ok) {
      toast.success("Відхилено");
      setDecisions((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } else {
      toast.error(result?.error ?? "Помилка");
    }
  };

  const bulkReject = async (actionType: string) => {
    if (!confirm(`Відхилити всі pending дії типу "${ACTION_TYPE_LABELS[actionType] ?? actionType}"?`)) return;
    setBulkBusy(actionType);
    const { data, error } = await supabase.rpc("owner_bulk_reject_decisions", {
      _tenant_id: tenantId,
      _action_type: actionType,
      _reason: "bulk_dismiss",
    });
    setBulkBusy(null);
    if (error) { toast.error(error.message); return; }
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
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                    onClick={() => bulkReject(type)}
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
          <Badge variant={stale ? "destructive" : "secondary"} className="gap-1">
            {stale ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {ageHours < 1 ? "<1 год" : `${ageHours} год тому`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {d.rationale && <p className="text-sm">{d.rationale}</p>}
        <ForecastBlock payload={d.payload} />
      </CardContent>

      {/* legacy expected_impact dump kept hidden — forecast is now in payload.forecast */}
      <CardContent className="hidden">
        {d.expected_impact && JSON.stringify(d.expected_impact)}

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
