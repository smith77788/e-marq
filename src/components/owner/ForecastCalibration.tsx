/**
 * /brand/insights — Forecast Calibration block.
 * Compares predicted expected_revenue (set at decision creation) vs measured
 * action_outcomes.attributed_revenue. Helps owners trust the forecast.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Target, TrendingUp, TrendingDown } from "lucide-react";

type CalibrationRow = {
  action_type: string;
  sample_size: number;
  avg_forecast_cents: number;
  avg_actual_cents: number;
  bias_cents: number;
  mape_pct: number | null;
  hit_rate: number;
  median_ratio: number | null;
  scope: "tenant" | "global";
  computed_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  cross_sell_recommend: "Крос-продаж",
  repeat_purchase_nudge: "Повторна покупка",
  winback_outreach: "Winback",
  feature_product: "Виділити товар",
  request_review: "Запит відгуку",
  request_ugc: "UGC-запит",
  discount_dead_stock: "Знижка на залишки",
  price_adjust: "Коригування ціни",
};

function fmtUah(cents: number): string {
  return (cents / 100).toLocaleString("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  });
}

export function ForecastCalibration({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<CalibrationRow[] | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_forecast_calibration", {
        _tenant_id: tenantId,
      });
      if (cancelled) return;
      if (error) {
        console.error("get_forecast_calibration error", error);
        setRows([]);
        return;
      }
      setRows((data ?? []) as CalibrationRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (rows === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            Точність прогнозу
          </CardTitle>
          <CardDescription>
            Як тільки накопичиться достатньо виміряних outcomes (24год+ після виконання дії), тут
            з'явиться калібрування передбачень. Daily cron оновлює дані о 04:30 UTC.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4" />
          Точність прогнозу AI
        </CardTitle>
        <CardDescription>
          Порівняння очікуваного доходу (момент створення рішення) з виміряним результатом (24год+
          після виконання). MAPE = середня похибка у %, hit-rate = частка дій з реальним лiфтом.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => {
          const overshoot = r.bias_cents < 0; // forecast > actual
          const undershoot = r.bias_cents > 0; // forecast < actual (system better than predicted)
          return (
            <div
              key={`${r.action_type}-${r.scope}`}
              className="flex items-center justify-between rounded border border-border/40 p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{ACTION_LABELS[r.action_type] ?? r.action_type}</span>
                <Badge variant="outline" className="text-xs">
                  n={r.sample_size}
                </Badge>
                {r.scope === "global" && (
                  <Badge variant="secondary" className="text-xs">
                    бенчмарк
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>прогноз: {fmtUah(r.avg_forecast_cents)}</span>
                <span>факт: {fmtUah(r.avg_actual_cents)}</span>
                <span className={undershoot ? "text-green-600" : overshoot ? "text-amber-600" : ""}>
                  {undershoot && <TrendingUp className="inline h-3 w-3" />}
                  {overshoot && <TrendingDown className="inline h-3 w-3" />}{" "}
                  {r.bias_cents >= 0 ? "+" : ""}
                  {fmtUah(r.bias_cents)}
                </span>
                {r.mape_pct != null && <span>MAPE: {Math.round(Number(r.mape_pct))}%</span>}
                <span>hit: {Math.round(Number(r.hit_rate) * 100)}%</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
