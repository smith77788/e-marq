/**
 * CronHealthCard — agregat last-50-runs success rate across all pg_cron jobs.
 * Shows: total jobs, healthy (>=90%), warning (70-89%), failing (<70%), idle (no runs).
 * Uses admin_list_cron_jobs() RPC.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

type CronJobRow = {
  out_jobid: number;
  out_jobname: string;
  out_schedule: string;
  out_active: boolean;
  out_command: string;
  out_last_run_started: string | null;
  out_last_run_status: string | null;
  out_runs_50: number;
  out_successes_50: number;
};

type Tier = "ok" | "warn" | "fail" | "idle";

function tierFor(row: CronJobRow): Tier {
  if (!row.out_active) return "idle";
  if (row.out_runs_50 === 0) return "idle";
  const rate = row.out_successes_50 / row.out_runs_50;
  if (rate >= 0.9) return "ok";
  if (rate >= 0.7) return "warn";
  return "fail";
}

export function CronHealthCard() {
  const { t } = useT();
  const query = useQuery({
    queryKey: ["admin-cron-health"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_cron_jobs");
      if (error) throw error;
      return (data ?? []) as CronJobRow[];
    },
  });

  const rows = query.data ?? [];
  const counts = rows.reduce(
    (acc, r) => {
      acc[tierFor(r)]++;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0, idle: 0 } as Record<Tier, number>,
  );
  const failing = rows
    .filter((r) => tierFor(r) === "fail")
    .sort(
      (a, b) =>
        a.out_successes_50 / Math.max(1, a.out_runs_50) -
        b.out_successes_50 / Math.max(1, b.out_runs_50),
    )
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              {t("hm.cron.title")}
            </CardTitle>
            <CardDescription>{t("hm.cron.subtitle")}</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {rows.length} {t("hm.cron.jobs")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile tone="ok" icon={CheckCircle2} label={t("hm.cron.healthy")} value={counts.ok} />
              <Tile
                tone="warn"
                icon={AlertTriangle}
                label={t("hm.cron.warn")}
                value={counts.warn}
              />
              <Tile tone="fail" icon={XCircle} label={t("hm.cron.failing")} value={counts.fail} />
              <Tile tone="idle" icon={CircleDashed} label={t("hm.cron.idle")} value={counts.idle} />
            </div>
            {failing.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("hm.cron.worst")}</p>
                <ul className="space-y-1">
                  {failing.map((r) => (
                    <li
                      key={r.out_jobid}
                      className="flex items-center justify-between gap-2 rounded border border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono truncate">{r.out_jobname}</span>
                      <span className="shrink-0 tabular-nums text-destructive">
                        {r.out_successes_50}/{r.out_runs_50}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  tone,
  icon: Icon,
  label,
  value,
}: {
  tone: Tier;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
        : tone === "fail"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-muted-foreground/20 bg-muted/30 text-muted-foreground";
  return (
    <div className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 ${cls}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
