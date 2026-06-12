/**
 * CAC Payback Heatmap — cohort × channel matrix.
 * Reads from `cac_payback_metrics` (computed daily 04:35 UTC by `compute_cac_payback`).
 * Empty state guides owner to enter marketing spend.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Row = {
  cohort_month: string;
  channel: string;
  cac_cents: number;
  customer_count: number;
  payback_month: number | null;
  ltv_12m_cents: number;
  roi_pct: number;
};

function fmtMoney(cents: number) {
  return `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;
}

function paybackColor(pm: number | null): string {
  if (pm == null) return "color-mix(in oklab, var(--destructive) 25%, transparent)";
  if (pm <= 1) return "color-mix(in oklab, var(--primary) 60%, transparent)";
  if (pm <= 3) return "color-mix(in oklab, var(--primary) 40%, transparent)";
  if (pm <= 6) return "color-mix(in oklab, var(--primary) 20%, transparent)";
  return "color-mix(in oklab, var(--destructive) 20%, transparent)";
}

export function CacPaybackTable({ tenantId }: { tenantId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setFetchError(null);
    supabase
      .from("cac_payback_metrics")
      .select(
        "cohort_month, channel, cac_cents, customer_count, payback_month, ltv_12m_cents, roi_pct",
      )
      .eq("tenant_id", tenantId)
      .order("cohort_month", { ascending: false })
      .limit(36)
      .then(({ data, error }) => {
        if (error) {
          setFetchError(error.message);
        } else {
          setRows((data ?? []) as Row[]);
        }
        setLoading(false);
      });
  }, [tenantId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>CAC та окупність</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Завантаження…</CardContent>
      </Card>
    );
  }

  if (fetchError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>CAC та окупність</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">{fetchError}</CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>CAC та окупність</CardTitle>
          <CardDescription>
            Внесіть marketing spend помісячно в розділі Налаштування → Marketing spend, і агент
            автоматично порахує CAC, payback month та ROI 12м для кожної когорти.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Дані з'являться після першого розрахунку (щодня 04:35 UTC).
        </CardContent>
      </Card>
    );
  }

  const avgPayback =
    rows.filter((r) => r.payback_month != null).reduce((s, r) => s + (r.payback_month ?? 0), 0) /
    Math.max(rows.filter((r) => r.payback_month != null).length, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          CAC та окупність
          <Badge variant="secondary">avg payback: {avgPayback.toFixed(1)} міс</Badge>
        </CardTitle>
        <CardDescription>
          Скільки місяців когорта повертає вкладення в маркетинг. Зелений = швидко, червоний = ще не
          окупилася.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Когорта</th>
                <th className="py-2 pr-3">Канал</th>
                <th className="py-2 pr-3 text-right">Клієнтів</th>
                <th className="py-2 pr-3 text-right">CAC</th>
                <th className="py-2 pr-3 text-right">LTV 12м</th>
                <th className="py-2 pr-3 text-right">ROI</th>
                <th className="py-2 pr-3 text-center">Payback</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.cohort_month}-${r.channel}`} className="border-b border-border/40">
                  <td className="py-2 pr-3 font-medium">
                    {new Date(r.cohort_month).toLocaleDateString("uk-UA", {
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="py-2 pr-3">{r.channel}</td>
                  <td className="py-2 pr-3 text-right">{r.customer_count}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(r.cac_cents)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(r.ltv_12m_cents)}</td>
                  <td
                    className={`py-2 pr-3 text-right font-medium ${
                      r.roi_pct >= 0 ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {r.roi_pct >= 0 ? "+" : ""}
                    {r.roi_pct.toFixed(0)}%
                  </td>
                  <td
                    className="py-2 pr-3 text-center font-mono text-xs rounded"
                    style={{ background: paybackColor(r.payback_month) }}
                  >
                    {r.payback_month == null ? "—" : `${r.payback_month}м`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
