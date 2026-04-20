import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Check, Loader2, Play, ShieldAlert, X, Zap } from "lucide-react";
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
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
  low: "bg-muted text-muted-foreground border-border",
};

export function AcosInsightsQueue({ tenantId }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "new" | "in_review">("new");

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["acos-insights-queue", tenantId, filter],
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
        .limit(100);
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
    refetchInterval: 30_000,
  });

  const runAgent = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/hooks/agents/churn-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const json = (await res.json()) as { success?: boolean; insights_created?: number; vip_at_risk?: number; error?: string; details?: string };
      if (!res.ok || !json.success) throw new Error(json.details || json.error || `HTTP ${res.status}`);
      return json;
    },
    onSuccess: (r) => {
      toast.success(`Churn agent done — ${r.insights_created ?? 0} new insights, ${r.vip_at_risk ?? 0} VIPs at risk`);
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
    },
    onError: (e: Error) => toast.error(`Agent failed: ${e.message}`),
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

  const counts = {
    new: insights.filter((i) => i.status === "new").length,
    in_review: insights.filter((i) => i.status === "in_review").length,
    high: insights.filter((i) => i.risk_level === "high").length,
  };

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
              Review agent findings and approve actions. Queue refreshes every 30s.
              {counts.high > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                  <ShieldAlert className="h-3 w-3" /> {counts.high} high-risk
                </span>
              )}
            </CardDescription>
          </div>
          <Button onClick={() => runAgent.mutate()} disabled={runAgent.isPending} size="sm">
            {runAgent.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
            Run Churn Risk agent
          </Button>
        </div>
        <div className="mt-2 flex gap-1.5">
          {(["new", "in_review", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {f === "new" ? "New" : f === "in_review" ? "In review" : "All"}
              {f !== "all" && counts[f] > 0 && <span className="ml-1.5 opacity-70">{counts[f]}</span>}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : insights.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <Zap className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No insights {filter !== "all" && `with status "${filter}"`}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Run Churn Risk agent" to scan VIP customers for recency drift.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[640px] pr-3">
            <div className="space-y-2">
              {insights.map((ins) => {
                const m = ins.metrics as {
                  email?: string;
                  drift_ratio?: number;
                  recency_days?: number;
                  avg_interval_days?: number;
                  total_spent_cents?: number;
                  order_count?: number;
                };
                return (
                  <div key={ins.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
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
                    {m?.drift_ratio && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                        <div><span className="text-foreground">{m.order_count}</span> orders</div>
                        <div>${((m.total_spent_cents ?? 0) / 100).toFixed(0)} LTV</div>
                        <div>{m.recency_days?.toFixed(0)}d silent</div>
                        <div>{m.drift_ratio.toFixed(2)}× drift</div>
                      </div>
                    )}
                    {ins.status !== "approved" && ins.status !== "dismissed" && (
                      <div className="mt-2 flex gap-1.5">
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
                      </div>
                    )}
                    {(ins.status === "approved" || ins.status === "dismissed") && (
                      <Badge variant="outline" className="mt-2 text-[10px]">{ins.status}</Badge>
                    )}
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
