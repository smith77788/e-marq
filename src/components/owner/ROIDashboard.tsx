/**
 * ROIDashboard — Phase 18: Owner ROI panel.
 * Shows cumulative AI value: actions, time saved, attributed revenue,
 * win-rate, top action, breakdown, 14-day trend.
 * Data source: public.get_owner_roi_summary(_tenant_id).
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Clock, DollarSign, Trophy, TrendingUp, Activity, BarChart3 } from "lucide-react";

type TrendPoint = { day: string; actions: number; revenue_cents: number };
type ActionRow = {
  action_type: string;
  executed_count: number;
  measured_count: number;
  revenue_cents: number;
  avg_lift_pct: number | null;
};
type Summary = {
  total_actions: number;
  total_revenue_cents: number;
  time_saved_minutes: number;
  time_saved_hours: number;
  win_rate_pct: number | null;
  avg_lift_pct: number | null;
  top_action: { action_type: string; total_revenue_cents: number; count: number } | null;
  by_action: ActionRow[];
  trend_14d: TrendPoint[];
  computed_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  owner_setup_task: "Налаштування магазину",
  vip_silent_outreach: "VIP-розсилка",
  stockout_restock_alert: "Алерт по stockout",
  low_stock_alert: "Низький залишок",
  dead_stock_promotion: "Промо мертвого стоку",
  abandoned_cart_recovery: "Відновлення кошика",
  owner_review: "Огляд власником",
  flag_for_review: "На перегляд",
};

function fmtUAH(cents: number) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(cents / 100) + " ₴";
}

function actionLabel(t: string) {
  return ACTION_LABELS[t] ?? t.replace(/_/g, " ");
}

export function ROIDashboard({ tenantId }: { tenantId: string | null }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data: row, error: rpcErr } = await supabase.rpc("get_owner_roi_summary", {
        _tenant_id: tenantId,
      });
      if (cancelled) return;
      if (rpcErr) {
        setError(rpcErr.message);
        setLoading(false);
        return;
      }
      setData(row as Summary);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!tenantId) return null;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ROI від AI</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ROI від AI</CardTitle>
          <CardDescription className="text-destructive">
            {error ?? "Немає даних"}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const maxRev = Math.max(1, ...data.trend_14d.map((p) => Number(p.revenue_cents)));
  const maxActions = Math.max(1, ...data.trend_14d.map((p) => p.actions));

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Автономних дій</div>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{data.total_actions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Зекономлено часу</div>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{data.time_saved_hours} год</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              ≈ 8 хв/дія
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Атрибутований дохід</div>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{fmtUAH(data.total_revenue_cents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Win-rate</div>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">
              {data.win_rate_pct !== null ? `${data.win_rate_pct}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {data.avg_lift_pct !== null ? `avg lift: ${data.avg_lift_pct}%` : "очікуємо вимірів"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Action */}
      {data.top_action && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Топ-перемога
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{actionLabel(data.top_action.action_type)}</div>
                <div className="text-xs text-muted-foreground">
                  {data.top_action.count} дій
                </div>
              </div>
              <div className="text-lg font-bold text-emerald-600">
                +{fmtUAH(data.top_action.total_revenue_cents)}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 14-day trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            14-денний тренд
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.trend_14d.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Поки немає виконаних дій за останні 14 днів
            </div>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {data.trend_14d.map((p) => {
                const revPct = (Number(p.revenue_cents) / maxRev) * 100;
                const actPct = (p.actions / maxActions) * 100;
                return (
                  <div
                    key={p.day}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${p.day}: ${p.actions} дій, ${fmtUAH(Number(p.revenue_cents))}`}
                  >
                    <div className="w-full flex items-end justify-center gap-0.5 flex-1">
                      <div
                        className="w-1/2 bg-primary/30 rounded-t"
                        style={{ height: `${actPct}%`, minHeight: p.actions > 0 ? "2px" : "0" }}
                      />
                      <div
                        className="w-1/2 bg-emerald-500/60 rounded-t"
                        style={{
                          height: `${revPct}%`,
                          minHeight: Number(p.revenue_cents) > 0 ? "2px" : "0",
                        }}
                      />
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {p.day.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-3 text-xs text-muted-foreground mt-2 justify-center">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-primary/30 inline-block" /> дії
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-emerald-500/60 inline-block" /> дохід
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown by action_type */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Розбивка за типом дії</CardTitle>
          <CardDescription className="text-xs">
            Які саме автономні дії приносять найбільше
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.by_action.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Поки немає виконаних дій
            </div>
          ) : (
            <div className="space-y-2">
              {data.by_action.map((row) => (
                <div
                  key={row.action_type}
                  className="flex items-center justify-between text-sm border-b border-border/40 pb-2 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{actionLabel(row.action_type)}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.executed_count} дій
                      {row.measured_count > 0 && ` · ${row.measured_count} виміряно`}
                      {row.avg_lift_pct !== null && ` · lift ${row.avg_lift_pct}%`}
                    </div>
                  </div>
                  <div className="text-right">
                    {Number(row.revenue_cents) > 0 ? (
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        +{fmtUAH(Number(row.revenue_cents))}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">очікуємо вимірів</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
