import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Boxes,
  Check,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type InsightRow = {
  id: string;
  insight_type: string;
  affected_layer: string | null;
  title: string;
  description: string;
  expected_impact: string | null;
  confidence: number;
  risk_level: string;
  status: string;
  metrics: Record<string, unknown>;
  created_at: string;
};

const RISK_STYLES: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-warning/15 text-warning-foreground border-warning/40",
  low: "bg-muted text-muted-foreground border-border",
};

const TYPE_ICONS: Record<string, typeof Users> = {
  churn_risk: Users,
  stockout_predicted: Boxes,
  aov_leak: ShoppingCart,
  search_gap: Search,
};

const SINGLE_AGENTS: { id: string; label: string }[] = [
  { id: "churn-risk", label: "Churn Risk" },
  { id: "stockout", label: "Stockout" },
  { id: "aov-leak", label: "AOV Leak" },
  { id: "search-gap", label: "Search Gap" },
];

async function authedFetch(path: string, body: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: string; details?: string };
  if (!res.ok || json.success === false) {
    throw new Error(typeof json.details === "string" ? json.details : typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export function AcosInsightsQueue({ tenantId }: Props) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "in_review" | "approved" | "applied">("new");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["acos-insights-queue", tenantId, statusFilter, typeFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("ai_insights")
        .select(
          "id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("confidence", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(150);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (typeFilter !== "all") q = q.eq("insight_type", typeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
    refetchInterval: 30_000,
  });

  const runAll = useMutation({
    mutationFn: () => authedFetch("/hooks/agents/run-all", { tenant_id: tenantId }),
    onSuccess: (r) => {
      toast.success(`Orchestrator complete — ${r.insights_created ?? 0} new insights across all agents`);
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-agent-runs", tenantId] });
    },
    onError: (e: Error) => toast.error(`Orchestrator failed: ${e.message}`),
  });

  const runOne = useMutation({
    mutationFn: (agent: string) => authedFetch(`/hooks/agents/${agent}`, { tenant_id: tenantId }),
    onSuccess: (r, agent) => {
      toast.success(`${agent} done — ${r.insights_created ?? 0} new insights`);
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-agent-runs", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("ai_insights").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.status === "approved" ? "Approved" : vars.status === "dismissed" ? "Dismissed" : "Updated");
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyAction = useMutation({
    mutationFn: (insightId: string) => authedFetch("/hooks/actions/apply", { insight_id: insightId }),
    onSuccess: (r) => {
      toast.success(`Action applied: ${(r as { action_type?: string }).action_type ?? "ok"}`);
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-actions", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = {
    new: insights.filter((i) => i.status === "new").length,
    in_review: insights.filter((i) => i.status === "in_review").length,
    approved: insights.filter((i) => i.status === "approved").length,
    applied: insights.filter((i) => i.status === "applied").length,
    high: insights.filter((i) => i.risk_level === "high").length,
  };

  const types = Array.from(new Set(insights.map((i) => i.insight_type)));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Insights Queue
            </CardTitle>
            <CardDescription>
              Review AI-agent findings and approve actions. Auto-refreshes every 30s.
              {counts.high > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                  <ShieldAlert className="h-3 w-3" /> {counts.high} high-risk
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => runAll.mutate()} disabled={runAll.isPending} size="sm">
              {runAll.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
              Run all agents
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SINGLE_AGENTS.map((a) => (
            <Button
              key={a.id}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={runOne.isPending}
              onClick={() => runOne.mutate(a.id)}
            >
              {runOne.isPending && runOne.variables === a.id ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Play className="mr-1 h-3 w-3" />
              )}
              {a.label}
            </Button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(["new", "in_review", "approved", "applied", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {f === "in_review" ? "In review" : f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                {f !== "all" && counts[f] > 0 && <span className="ml-1.5 opacity-70">{counts[f]}</span>}
              </button>
            ))}
          </div>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setTypeFilter("all")}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                  typeFilter === "all"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                }`}
              >
                All types
              </button>
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    typeFilter === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : insights.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No insights match the current filter</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Run all agents" — Churn Risk, Stockout, AOV Leak and Search Gap will scan this tenant.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[680px] pr-3">
            <div className="space-y-2">
              {insights.map((ins) => {
                const Icon = TYPE_ICONS[ins.insight_type] ?? Sparkles;
                const m = ins.metrics as Record<string, unknown>;
                return (
                  <div key={ins.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      <Badge variant="outline" className={`text-[10px] ${RISK_STYLES[ins.risk_level] ?? ""}`}>
                        {ins.risk_level}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{ins.insight_type}</Badge>
                      {ins.affected_layer && (
                        <Badge variant="secondary" className="text-[10px]">{ins.affected_layer}</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">conf {(ins.confidence * 100).toFixed(0)}%</Badge>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(ins.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{ins.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ins.description}</p>
                    {ins.expected_impact && (
                      <p className="mt-1 text-xs font-medium text-primary">→ {ins.expected_impact}</p>
                    )}
                    <MetricsLine type={ins.insight_type} m={m} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(ins.status === "new" || ins.status === "in_review") && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            disabled={updateStatus.isPending}
                            onClick={() => updateStatus.mutate({ id: ins.id, status: "approved" })}
                          >
                            <Check className="mr-1 h-3 w-3" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={updateStatus.isPending}
                            onClick={() => updateStatus.mutate({ id: ins.id, status: "dismissed" })}
                          >
                            <X className="mr-1 h-3 w-3" /> Dismiss
                          </Button>
                        </>
                      )}
                      {ins.status === "approved" && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          disabled={applyAction.isPending}
                          onClick={() => applyAction.mutate(ins.id)}
                        >
                          {applyAction.isPending && applyAction.variables === ins.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="mr-1 h-3 w-3" />
                          )}
                          Apply action
                        </Button>
                      )}
                      {(ins.status === "applied" || ins.status === "dismissed") && (
                        <Badge variant="outline" className="text-[10px]">{ins.status}</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsLine({ type, m }: { type: string; m: Record<string, unknown> }) {
  const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  if (type === "churn_risk") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div><span className="text-foreground">{num("order_count")}</span> orders</div>
        <div>${(((num("total_spent_cents") ?? 0) as number) / 100).toFixed(0)} LTV</div>
        <div>{num("recency_days")?.toFixed(0)}d silent</div>
        <div>{num("drift_ratio")?.toFixed(2)}× drift</div>
      </div>
    );
  }
  if (type === "stockout_predicted") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div><span className="text-foreground">{num("stock")}</span> in stock</div>
        <div>{num("velocity_per_day")?.toFixed(2)} u/day</div>
        <div>{num("days_of_supply")?.toFixed(1)}d cover</div>
        <div>reorder {num("suggested_reorder_qty")}</div>
      </div>
    );
  }
  if (type === "aov_leak") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div><span className="text-foreground">{num("abandoned_sessions")}</span> abandoned</div>
        <div>{num("abandoned_checkouts")} stuck at checkout</div>
        <div>recover ~{num("recoverable_sessions")}</div>
        <div>${(((num("recoverable_revenue_cents") ?? 0) as number) / 100).toFixed(0)} ↺</div>
      </div>
    );
  }
  if (type === "search_gap") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
        <div>"{str("search_term")}"</div>
        <div>{num("searches_zero_results")} zero-result hits</div>
        <div>{((num("miss_rate") ?? 0) * 100).toFixed(0)}% miss rate</div>
      </div>
    );
  }
  return null;
}
