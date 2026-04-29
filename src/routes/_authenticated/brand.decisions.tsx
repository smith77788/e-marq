/**
 * /brand/decisions — Owner Decision Inbox.
 * Сюди ведуть Telegram-нотифікації про pending decisions, які потребують
 * рішення власника (owner_setup_task / owner_review / flag_for_review).
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, X, Clock, AlertCircle } from "lucide-react";

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

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("decision_queue")
      .select("id, tenant_id, agent_id, action_type, title, rationale, payload, confidence, expected_impact, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100);
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
      _reason: reason || null,
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

  if (decisions === null) {
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

  return (
    <div className="space-y-3">
      {decisions.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          busy={busyId === d.id}
          onApprove={() => approve(d.id)}
          onReject={(reason) => reject(d.id, reason)}
        />
      ))}
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
    <Card className={stale ? "border-amber-500/40" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{d.title ?? d.action_type}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{d.action_type}</Badge>
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
        {d.expected_impact && Object.keys(d.expected_impact).length > 0 && (
          <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">
            {JSON.stringify(d.expected_impact, null, 2)}
          </pre>
        )}

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
