import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentHealthRow = {
  agent_id: string;
  runs_total: number;
  runs_failed: number;
  insights_created: number;
};

type Props = {
  rows: AgentHealthRow[];
};

function statusFor(row: AgentHealthRow): "ok" | "warn" | "fail" {
  if (row.runs_total === 0) return "warn";
  const failRate = row.runs_failed / row.runs_total;
  if (failRate > 0.3) return "fail";
  if (failRate > 0.05) return "warn";
  return "ok";
}

const STATUS_META: Record<
  ReturnType<typeof statusFor>,
  { icon: typeof CheckCircle2; color: string; bg: string }
> = {
  ok: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10 ring-success/30" },
  warn: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10 ring-warning/30" },
  fail: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10 ring-destructive/30" },
};

export function SystemHealthGrid({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No agent runs in the last 24h.</p>
    );
  }
  // Aggregate by agent_id
  const agg = new Map<string, AgentHealthRow>();
  for (const r of rows) {
    const cur = agg.get(r.agent_id) ?? {
      agent_id: r.agent_id,
      runs_total: 0,
      runs_failed: 0,
      insights_created: 0,
    };
    cur.runs_total += r.runs_total;
    cur.runs_failed += r.runs_failed;
    cur.insights_created += r.insights_created;
    agg.set(r.agent_id, cur);
  }
  const list = [...agg.values()].sort((a, b) => b.runs_total - a.runs_total);
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {list.map((row) => {
        const status = statusFor(row);
        const meta = STATUS_META[status];
        const Icon = meta.icon;
        return (
          <div
            key={row.agent_id}
            className={cn(
              "group flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 p-2 ring-1 transition-all hover:scale-[1.02]",
              meta.bg,
            )}
            title={`${row.runs_total} runs · ${row.runs_failed} failed · ${row.insights_created} insights`}
          >
            <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-foreground">
                {row.agent_id}
              </p>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {row.runs_total} runs · {row.insights_created} ins
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
