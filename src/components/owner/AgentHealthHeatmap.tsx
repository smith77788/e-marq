/**
 * Agent health heatmap — fleet-wide view of agent activity & success.
 * Grid of cells: rows = agent_id, cols = last 14 days. Color intensity
 * encodes runs/day; red ring = failures present.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { humanizeAgentId } from "@/lib/acos/agentLabels";

type Props = { tenantId: string };

type Run = { agent_id: string; status: string; started_at: string; insights_created: number };

const DAYS = 14;

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function AgentHealthHeatmap({ tenantId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["agent-health-heatmap", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("acos_agent_runs")
        .select("agent_id, status, started_at, insights_created")
        .eq("tenant_id", tenantId)
        .gte("started_at", since)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });

  const grid = useMemo(() => {
    const dayKeys: string[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const iso = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString();
      dayKeys.push(dayKey(iso));
    }
    const agents = new Map<
      string,
      {
        total: number;
        failed: number;
        insights: number;
        perDay: Map<string, { runs: number; failed: number; insights: number }>;
      }
    >();
    for (const r of data ?? []) {
      const a = agents.get(r.agent_id) ?? { total: 0, failed: 0, insights: 0, perDay: new Map() };
      a.total++;
      if (r.status !== "success") a.failed++;
      a.insights += r.insights_created;
      const dk = dayKey(r.started_at);
      const d = a.perDay.get(dk) ?? { runs: 0, failed: 0, insights: 0 };
      d.runs++;
      if (r.status !== "success") d.failed++;
      d.insights += r.insights_created;
      a.perDay.set(dk, d);
      agents.set(r.agent_id, a);
    }
    const rows = Array.from(agents.entries())
      .map(([agent_id, v]) => ({ agent_id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 18);
    const maxRunsPerDay = Math.max(
      1,
      ...rows.flatMap((r) => Array.from(r.perDay.values()).map((d) => d.runs)),
    );
    return { dayKeys, rows, maxRunsPerDay };
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cpu className="h-4 w-4 text-primary" />
            Робота агентів · 14 днів
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 animate-pulse rounded-md bg-muted/30" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cpu className="h-4 w-4 text-primary" />
          Робота агентів · 14 днів
          <Badge variant="outline" className="ml-auto text-[10px]">
            {grid.rows.length} агентів
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Скільки разів кожен агент запускався щодня. Червона рамка = була хоча б одна помилка в той
          день.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grid.rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            За останні {DAYS} днів агенти ще не працювали. Запустіть вручну або зачекайте на
            наступний автоматичний цикл.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-[10px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pr-2 py-1 font-medium sticky left-0 bg-card">Агент</th>
                  {grid.dayKeys.map((dk) => (
                    <th key={dk} className="px-0.5 py-1 font-medium text-center w-6">
                      {Number(dk.slice(8))}
                    </th>
                  ))}
                  <th className="pl-2 text-right font-medium">Усього</th>
                  <th className="pl-2 text-right font-medium text-primary">Підказки</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => {
                  return (
                    <tr key={r.agent_id} className="border-t border-border/40">
                      <td
                        className="pr-2 py-1 text-[10px] text-foreground sticky left-0 bg-card max-w-[140px] truncate"
                        title={humanizeAgentId(r.agent_id)}
                      >
                        {humanizeAgentId(r.agent_id)}
                      </td>
                      {grid.dayKeys.map((dk) => {
                        const d = r.perDay.get(dk);
                        const runs = d?.runs ?? 0;
                        const failed = d?.failed ?? 0;
                        const intensity = runs > 0 ? Math.min(1, runs / grid.maxRunsPerDay) : 0;
                        const bg =
                          runs === 0
                            ? "color-mix(in oklab, var(--muted) 25%, transparent)"
                            : `color-mix(in oklab, var(--primary) ${Math.round(18 + intensity * 70)}%, transparent)`;
                        const ring =
                          failed > 0
                            ? "0 0 0 1.5px color-mix(in oklab, var(--destructive) 70%, transparent) inset"
                            : "none";
                        return (
                          <td key={dk} className="p-0.5">
                            <div
                              className="h-5 w-5 rounded-sm transition-all"
                              title={`${dk}: запусків ${runs} · помилок ${failed} · підказок ${d?.insights ?? 0}`}
                              style={{ background: bg, boxShadow: ring }}
                            />
                          </td>
                        );
                      })}
                      <td className="pl-2 text-right tabular-nums text-foreground">{r.total}</td>
                      <td className="pl-2 text-right tabular-nums text-primary">{r.insights}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>Рідше працює</span>
              {[18, 35, 55, 72, 88].map((p) => (
                <span
                  key={p}
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: `color-mix(in oklab, var(--primary) ${p}%, transparent)` }}
                />
              ))}
              <span>Частіше працює</span>
              <span className="ml-2 inline-flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{
                    boxShadow:
                      "0 0 0 1.5px color-mix(in oklab, var(--destructive) 70%, transparent) inset",
                  }}
                />
                Була помилка
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
