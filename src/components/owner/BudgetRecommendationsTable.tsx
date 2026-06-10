/**
 * BudgetRecommendationsTable — рендерить рекомендації SQL Agent #22.
 * Read-only: усі дії приземляються в Decision Inbox через owner_review.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Row = {
  id: string;
  channel: string;
  current_spend_cents: number;
  recommended_spend_cents: number;
  delta_pct: number;
  recommendation: string;
  predicted_ltv_cents: number;
  cac_cents: number;
  payback_months: number | null;
  n_orders: number;
  confidence: string;
  rationale: Record<string, unknown> | null;
};

const fmt = (cents: number) =>
  new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(cents / 100);

export function BudgetRecommendationsTable({ tenantId }: { tenantId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-recs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budget_recommendations")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("computed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  if (!tenantId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Рекомендації по бюджету</CardTitle>
        <CardDescription>
          Автоматичний аналіз LTV/CAC і часу окупності каналів. Підтверджуйте зміни в Decision
          Inbox.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Поки немає даних — додайте витрати в Налаштування → Маркетинг і зачекайте до завтра.
          </p>
        ) : (
          <TooltipProvider>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Канал</th>
                    <th className="py-2 pr-3">Поточно</th>
                    <th className="py-2 pr-3">Рекомендовано</th>
                    <th className="py-2 pr-3">Δ</th>
                    <th className="py-2 pr-3">LTV/CAC</th>
                    <th className="py-2 pr-3">Payback</th>
                    <th className="py-2 pr-3">Впевненість</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data]
                    .sort(
                      (a, b) =>
                        Math.abs(b.recommended_spend_cents - b.current_spend_cents) -
                        Math.abs(a.recommended_spend_cents - a.current_spend_cents),
                    )
                    .map((r) => {
                      const ltvCac =
                        r.cac_cents > 0 ? (r.predicted_ltv_cents / r.cac_cents).toFixed(2) : "—";
                      const tone =
                        r.recommendation === "scale"
                          ? "default"
                          : r.recommendation === "cut"
                            ? "destructive"
                            : "secondary";
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="py-2 pr-3 font-medium">{r.channel}</td>
                          <td className="py-2 pr-3">{fmt(r.current_spend_cents)} ₴</td>
                          <td className="py-2 pr-3">{fmt(r.recommended_spend_cents)} ₴</td>
                          <td className="py-2 pr-3">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant={tone}>
                                  {r.delta_pct >= 0 ? "+" : ""}
                                  {Math.round(r.delta_pct)}%
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <pre className="text-xs">
                                  {JSON.stringify(r.rationale ?? {}, null, 2)}
                                </pre>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="py-2 pr-3">{ltvCac}</td>
                          <td className="py-2 pr-3">
                            {r.payback_months ? `${r.payback_months.toFixed(1)} міс` : "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline">{r.confidence}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
