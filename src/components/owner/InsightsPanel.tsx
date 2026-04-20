import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Lightbulb, Loader2, Sparkles, TrendingDown, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type Insight = {
  id: string;
  insight_type: string;
  title: string;
  description: string;
  expected_impact: string | null;
  confidence: number;
  risk_level: string;
  status: string;
  created_at: string;
};

const TYPE_STYLE: Record<string, { Icon: typeof Lightbulb; cls: string }> = {
  low_engagement_product: { Icon: TrendingDown, cls: "text-warning-foreground bg-warning/10 border-warning/30" },
  cart_abandon: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10 border-destructive/30" },
  stockout: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10 border-destructive/30" },
  churn_risk: { Icon: TrendingDown, cls: "text-warning-foreground bg-warning/10 border-warning/30" },
};

async function authedFetch(path: string, body: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; details?: string };
  if (!res.ok) throw new Error(typeof json.details === "string" ? json.details : typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  return json;
}

export function InsightsPanel({ tenantId }: Props) {
  const qc = useQueryClient();

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["insights", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_insights")
        .select("id, insight_type, title, description, expected_impact, confidence, risk_level, status, created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "new")
        .order("confidence", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Insight[];
    },
    refetchInterval: 60_000,
  });

  const apply = useMutation({
    mutationFn: (insightId: string) => authedFetch("/hooks/actions/apply", { tenant_id: tenantId, insight_id: insightId }),
    onSuccess: (r) => {
      const queued = (r.outcome as { queued?: number } | undefined)?.queued ?? 0;
      const sent = (r.dispatch as { sent?: number } | undefined)?.sent ?? 0;
      toast.success(queued > 0 ? `Applied — ${queued} customers queued, ${sent} sent` : "Insight acknowledged");
      qc.invalidateQueries({ queryKey: ["insights", tenantId] });
      qc.invalidateQueries({ queryKey: ["revenue-feed", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dismiss = useMutation({
    mutationFn: async (insightId: string) => {
      const { error } = await supabase.from("ai_insights").update({ status: "dismissed" }).eq("id", insightId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dismissed");
      qc.invalidateQueries({ queryKey: ["insights", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          What I found for you
        </CardTitle>
        <CardDescription>Insights from the AOV optimizer & risk agents. One click to act.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : insights.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            <p className="mt-3 text-sm font-medium">All clear</p>
            <p className="mt-1 text-xs text-muted-foreground">No new insights. Agents run on schedule.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {insights.map((i) => {
              const style = TYPE_STYLE[i.insight_type] ?? { Icon: Lightbulb, cls: "text-muted-foreground bg-muted/30 border-border" };
              const Icon = style.Icon;
              const pending = apply.isPending && apply.variables === i.id;
              return (
                <div key={i.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${style.cls}`}>
                      <Icon className="mr-1 h-3 w-3" />
                      {i.insight_type.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(i.confidence * 100)}% confident
                    </Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(i.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{i.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{i.description}</p>
                  {i.expected_impact && (
                    <p className="mt-1 text-[11px] font-medium text-primary">💰 {i.expected_impact}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => apply.mutate(i.id)} disabled={pending}>
                      {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(i.id)} disabled={dismiss.isPending}>
                      <X className="mr-1 h-3.5 w-3.5" /> Dismiss
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
