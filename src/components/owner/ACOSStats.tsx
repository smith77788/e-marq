/**
 * ACOSStats — підсумковий блок для /brand/insights.
 * Показує власнику цінність автономного режиму: дій виконано, виручка,
 * win-rate, розподіл по типах. Дані з public.get_acos_stats().
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Activity, TrendingUp, Zap, Target, Inbox } from "lucide-react";

type Stats = {
  ok: boolean;
  done: { h24: number; d7: number; d30: number; all: number };
  approval_split: { auto_count: number; manual_count: number };
  outcomes: {
    measured: number;
    wins: number;
    losses: number;
    revenue_cents_total: number;
    revenue_cents_30d: number;
  };
  by_type: { action_type: string; cnt: number }[];
  pending_inbox: number;
  as_of: string;
};

const ACTION_LABELS: Record<string, string> = {
  owner_setup_task: "Налаштування магазину",
  owner_review: "Потребує перегляду",
  flag_for_review: "Помічено",
  feature_product: "Виділити товар",
  cross_sell_recommend: "Cross-sell",
  request_review: "Запит відгуку",
  outreach_send: "Outreach",
  promo_apply: "Промо-знижка",
  restock_alert: "Поповнення складу",
};

function formatMoney(cents: number): string {
  if (!cents) return "0 ₴";
  const uah = cents / 100;
  if (uah >= 1000) return `${(uah / 1000).toFixed(1)}k ₴`;
  return `${uah.toFixed(0)} ₴`;
}

export function ACOSStats({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    supabase.rpc("get_acos_stats", { _tenant_id: tenantId }).then(({ data, error }) => {
      if (!mounted) return;
      if (!error && data && (data as { ok?: boolean }).ok) {
        setStats(data as unknown as Stats);
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  if (loading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (!stats) {
    return null;
  }

  const winRate =
    stats.outcomes.measured > 0
      ? Math.round((stats.outcomes.wins / stats.outcomes.measured) * 100)
      : null;
  const totalApproved = stats.approval_split.auto_count + stats.approval_split.manual_count;
  const autoPct =
    totalApproved > 0 ? Math.round((stats.approval_split.auto_count / totalApproved) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          AI Activity Summary
        </CardTitle>
        <CardDescription>Що автономна система зробила для вашого бізнесу</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI
            icon={<Zap className="h-4 w-4" />}
            label="Дій за 24 год"
            value={String(stats.done.h24)}
            sub={`${stats.done.d7} за тиждень`}
          />
          <KPI
            icon={<TrendingUp className="h-4 w-4" />}
            label="Виручка (30д)"
            value={formatMoney(stats.outcomes.revenue_cents_30d)}
            sub={`Усього: ${formatMoney(stats.outcomes.revenue_cents_total)}`}
          />
          <KPI
            icon={<Target className="h-4 w-4" />}
            label="Win-rate"
            value={winRate !== null ? `${winRate}%` : "—"}
            sub={
              stats.outcomes.measured > 0
                ? `${stats.outcomes.wins}/${stats.outcomes.measured} виміряно`
                : "Чекаємо вимірювання"
            }
          />
          <KPI
            icon={<Inbox className="h-4 w-4" />}
            label="Pending Inbox"
            value={String(stats.pending_inbox)}
            sub={`Auto: ${autoPct}% / Manual: ${100 - autoPct}%`}
          />
        </div>

        {/* By type */}
        {stats.by_type.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Топ дій за 30 днів</p>
            <div className="flex flex-wrap gap-2">
              {stats.by_type.map((row) => (
                <Badge key={row.action_type} variant="secondary" className="gap-1">
                  <span>{ACTION_LABELS[row.action_type] ?? row.action_type}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono">{row.cnt}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Bootstrap notice */}
        {stats.outcomes.measured === 0 && stats.done.all > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            Auto-approval працює у <strong>bootstrap-режимі</strong> (до 3 дій на тип). Перші
            вимірювання з'являться через 24 год після виконання дій — після цього система перейде у
            режим навчання на історії та почне приймати рішення на основі реального win-rate.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KPI({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
