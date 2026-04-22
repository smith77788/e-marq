import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { Activity, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { humanizeAgentId, AGENT_HUMAN_LABELS } from "@/lib/acos/agentLabels";

type Props = { tenantId: string };

type RunRow = {
  id: string;
  agent_id: string;
  status: string;
  insights_created: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

const AGENT_LABEL = AGENT_HUMAN_LABELS;

export function AcosAgentRuns({ tenantId }: Props) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["acos-agent-runs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acos_agent_runs")
        .select("id, agent_id, status, insights_created, started_at, finished_at, error, metadata")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as RunRow[];
    },
    refetchInterval: 15_000,
  });

  // Group by agent → latest run
  const latestByAgent = new Map<string, RunRow>();
  for (const r of runs) {
    if (!latestByAgent.has(r.agent_id)) latestByAgent.set(r.agent_id, r);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Запуски агентів
        </CardTitle>
        <CardDescription>Стан і історія роботи ШІ-агентів для цього магазину.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Поки немає запусків. Натисніть «Запустити всіх агентів» вище, щоб запустити автоматику.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.keys(AGENT_LABEL).map((aid) => {
                const r = latestByAgent.get(aid);
                const statusUk = r
                  ? r.status === "success"
                    ? "успіх"
                    : r.status === "running"
                      ? "виконується"
                      : r.status === "error"
                        ? "помилка"
                        : r.status
                  : "";
                return (
                  <div key={aid} className="rounded-md border border-border bg-card p-2.5">
                    <div className="text-[11px] font-medium text-foreground">
                      {AGENT_LABEL[aid]}
                    </div>
                    {r ? (
                      <>
                        <div className="mt-1 flex items-center gap-1">
                          {r.status === "success" ? (
                            <CheckCircle2 className="h-3 w-3 text-success" />
                          ) : r.status === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          ) : (
                            <AlertCircle className="h-3 w-3 text-destructive" />
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {statusUk} · {r.insights_created} підказок
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(r.started_at), {
                            addSuffix: true,
                            locale: uk,
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 text-[10px] italic text-muted-foreground/70">
                        ще не запускався
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Останні запуски</div>
              {runs.slice(0, 12).map((r) => {
                const statusUk =
                  r.status === "success"
                    ? "успіх"
                    : r.status === "running"
                      ? "виконується"
                      : r.status === "error"
                        ? "помилка"
                        : r.status;
                return (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-xs"
                  >
                    <Badge variant="outline" className="text-[10px]">
                      {humanizeAgentId(r.agent_id)}
                    </Badge>
                    <span
                      className={`text-[10px] font-medium ${r.status === "success" ? "text-success" : r.status === "running" ? "text-primary" : "text-destructive"}`}
                    >
                      {statusUk}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.insights_created} підказок
                    </span>
                    {r.error && (
                      <span className="truncate text-[10px] text-destructive">{r.error}</span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(r.started_at), { addSuffix: true, locale: uk })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
