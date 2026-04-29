/**
 * ACOS Closed-Loop Dashboard
 * Власник бачить: воронку (insights → decisions → outcomes), pending decisions
 * для batch-апруву, та per-agent ROI за 30 днів.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, TrendingUp, Inbox } from "lucide-react";

type Overview = {
  tenant_id: string | null;
  tenant_name: string | null;
  insights_30d: number | null;
  insights_new: number | null;
  decisions_30d: number | null;
  decisions_pending: number | null;
  decisions_approved: number | null;
  decisions_done: number | null;
  decisions_failed: number | null;
  decisions_rejected: number | null;
  outcomes_total: number | null;
  outcomes_measured: number | null;
  outcomes_success: number | null;
  attributed_revenue_cents: number | null;
  success_rate: number | null;
};

type AgentPerf = {
  agent_id: string | null;
  action_type: string | null;
  executions: number | null;
  measured: number | null;
  successes: number | null;
  revenue_cents: number | null;
  success_rate: number | null;
  last_measured_at: string | null;
};

type Pending = {
  id: string;
  action_type: string;
  agent_id: string;
  title: string;
  rationale: string;
  confidence: number;
  risk_level: string;
  expected_impact: unknown;
  insight_type: string;
  created_at: string;
  expires_at: string;
};

const RISK_TONE: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-muted text-muted-foreground",
};

function fmtMoney(cents: number | null) {
  if (!cents) return "0 ₴";
  return `${Math.round(cents / 100).toLocaleString()} ₴`;
}

export function AcosLoopDashboard({ tenantId }: { tenantId: string }) {
  
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [agents, setAgents] = useState<AgentPerf[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [ovR, agR, pdR] = await Promise.all([
        supabase
          .from("acos_loop_overview")
          .select("*")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("agent_performance_30d")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("revenue_cents", { ascending: false })
          .limit(20),
        supabase.rpc("get_pending_decisions", { _tenant: tenantId, _limit: 50 }),
      ]);
      setOverview((ovR.data as Overview) ?? null);
      setAgents((agR.data as AgentPerf[]) ?? []);
      setPending((pdR.data as Pending[]) ?? []);
    } catch (e) {
      toast.error("Помилка завантаження", {
        description: String((e as Error)?.message ?? e),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const allChecked = pending.length > 0 && selected.size === pending.length;
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(pending.map((p) => p.id)));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const approveSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("approve_decisions", {
        _ids: Array.from(selected),
      });
      if (error) throw error;
      toast.success(`Схвалено: ${selected.size}`);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.error("Не вдалося схвалити", {
        description: String((e as Error)?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  };

  const rejectSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("reject_decisions", {
        _ids: Array.from(selected),
        _reason: "owner rejected from dashboard",
      });
      if (error) throw error;
      toast.success(`Відхилено: ${selected.size}`);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.error("Не вдалося відхилити", {
        description: String((e as Error)?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  };

  const successRatePct = useMemo(() => {
    const r = overview?.success_rate;
    if (r == null) return "—";
    return `${Math.round(Number(r) * 100)}%`;
  }, [overview]);

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard label="Insights 30д" value={overview?.insights_30d ?? 0} />
        <KpiCard
          label="Pending approval"
          value={overview?.decisions_pending ?? 0}
          tone={
            (overview?.decisions_pending ?? 0) > 0
              ? "text-warning"
              : "text-muted-foreground"
          }
        />
        <KpiCard label="Executing" value={overview?.decisions_executing ?? 0} />
        <KpiCard label="Done" value={overview?.decisions_done ?? 0} />
        <KpiCard
          label="Attributed revenue"
          value={fmtMoney(overview?.attributed_revenue_cents ?? 0)}
          tone="text-primary"
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {/* Pending queue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-warning" />
              Approval queue ({pending.length})
            </CardTitle>
            <CardDescription>
              Високоризикові дії, які агенти пропонують. Схваліть батч — runner
              виконає автоматично.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading || busy}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={approveSelected}
              disabled={selected.size === 0 || busy}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Схвалити ({selected.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={rejectSelected}
              disabled={selected.size === 0 || busy}
            >
              <XCircle className="mr-1 h-4 w-4" />
              Відхилити
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Черга порожня. Усе схвалено або агенти не знайшли нових ризикових дій.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3 border-b pb-2 text-xs text-muted-foreground">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                <span>Обрати все</span>
              </div>
              <ScrollArea className="h-[420px] pr-3">
                <div className="space-y-2">
                  {pending.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={selected.has(d.id)}
                        onCheckedChange={() => toggleOne(d.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{d.title}</span>
                          <Badge variant="outline" className="text-xs">
                            {d.action_type}
                          </Badge>
                          <Badge
                            className={`text-xs ${RISK_TONE[d.risk_level] ?? ""}`}
                          >
                            risk: {d.risk_level}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            conf {Math.round((d.confidence ?? 0) * 100)}%
                          </Badge>
                        </div>
                        {d.rationale && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {d.rationale}
                          </p>
                        )}
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {d.agent_id} · insight: {d.insight_type}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent performance */}
      <Card>
        <CardHeader>
          <CardTitle>Agent ROI (30 днів)</CardTitle>
          <CardDescription>
            Скільки виконано, скільки виміряно як успішні та атрибутований дохід.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Поки немає даних — measurement loop потребує 7 днів після виконання.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Agent</th>
                    <th className="pr-3">Action</th>
                    <th className="pr-3 text-right">Exec</th>
                    <th className="pr-3 text-right">Measured</th>
                    <th className="pr-3 text-right">✓</th>
                    <th className="pr-3 text-right">Success rate</th>
                    <th className="pr-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{a.agent_id}</td>
                      <td className="pr-3 text-muted-foreground">{a.action_type}</td>
                      <td className="pr-3 text-right">{a.executions ?? 0}</td>
                      <td className="pr-3 text-right">{a.measured ?? 0}</td>
                      <td className="pr-3 text-right">{a.successes ?? 0}</td>
                      <td className="pr-3 text-right">
                        {a.success_rate == null
                          ? "—"
                          : `${Math.round(Number(a.success_rate) * 100)}%`}
                      </td>
                      <td className="pr-3 text-right text-primary">
                        {fmtMoney(a.revenue_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer success-rate */}
      <p className="text-center text-xs text-muted-foreground">
        Loop success rate: <span className="font-medium">{successRatePct}</span> ·
        Outcomes measured: {overview?.outcomes_measured ?? 0}/
        {overview?.outcomes_total ?? 0}
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {icon}
        </div>
        <p className={`mt-2 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
