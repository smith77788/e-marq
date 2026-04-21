import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, Lightbulb, Loader2, Sparkles, TrendingDown, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { MSG } from "@/lib/glossary";
import type { InsightCopy, LocalizedCopy } from "@/lib/acos/insightCopy";

const INSIGHT_TYPE_LABEL: Record<string, string> = {
  low_engagement_product: "слабкий інтерес до товару",
  abandoned_cart: "покинутий кошик",
  stockout_predicted: "товар скоро закінчиться",
  churn_risk: "ризик втратити клієнта",
  cohort_segmentation: "групування клієнтів",
  winback_triggered: "повернення клієнта",
  ltv_score: "цінність клієнта",
  loyalty_tier: "програма лояльності",
  auto_promotion: "авто-промо",
  bundle_recommendation: "набір товарів",
  pricing_recommendation: "підбір ціни",
  elasticity_signal: "реакція на ціну",
  search_gap: "клієнти не знаходять",
  seo_opportunity: "можливість для SEO",
  aov_leak: "втрати в чеку",
  cart_recovery: "повернення кошика",
  checkout_friction: "перешкоди при оплаті",
  anomaly_revenue_dip: "падіння виторгу",
  anomaly_conversion_drop: "падіння конверсії",
  restock_alert: "час поповнити склад",
};

function humanType(t: string) {
  return INSIGHT_TYPE_LABEL[t] ?? t.replace(/_/g, " ");
}

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
  metrics: Record<string, unknown>;
};

const TYPE_STYLE: Record<string, { Icon: typeof Lightbulb; cls: string }> = {
  low_engagement_product: { Icon: TrendingDown, cls: "text-warning-foreground bg-warning/10 border-warning/30" },
  abandoned_cart: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10 border-destructive/30" },
  stockout_predicted: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10 border-destructive/30" },
  churn_risk: { Icon: TrendingDown, cls: "text-warning-foreground bg-warning/10 border-warning/30" },
};

function pickCopy(metrics: Record<string, unknown>, lang: "ua" | "en"): InsightCopy | null {
  const raw = metrics?._copy as LocalizedCopy | undefined;
  if (raw && typeof raw === "object" && raw[lang]) return raw[lang];
  return null;
}

async function authedFetch(path: string, body: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Спочатку увійдіть у систему");
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; details?: string };
  if (!res.ok) throw new Error(typeof json.details === "string" ? json.details : typeof json.error === "string" ? json.error : MSG.errGeneric);
  return json;
}

export function InsightsPanel({ tenantId }: Props) {
  const qc = useQueryClient();
  const { t, lang } = useT();
  const [openTech, setOpenTech] = useState<Record<string, boolean>>({});

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["insights", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_insights")
        .select("id, insight_type, title, description, expected_impact, confidence, risk_level, status, created_at, metrics")
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
    mutationFn: (insightId: string) => authedFetch("/hooks/actions/apply", { insight_id: insightId }),
    onSuccess: (r) => {
      const result = r as { actual_result?: { queued_messages?: number }; action_type?: string };
      const queued = result.actual_result?.queued_messages ?? 0;
      toast.success(
        queued > 0
          ? `Готово · поставили в чергу ${queued} повідомлень клієнтам`
          : MSG.applied,
      );
      qc.invalidateQueries({ queryKey: ["insights", tenantId] });
      qc.invalidateQueries({ queryKey: ["revenue-feed", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errApply),
  });

  const dismiss = useMutation({
    mutationFn: async (insightId: string) => {
      const { error } = await supabase.from("ai_insights").update({ status: "dismissed" }).eq("id", insightId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(MSG.dismissed);
      qc.invalidateQueries({ queryKey: ["insights", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errGeneric),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          {t("insights.title")}
        </CardTitle>
        <CardDescription>{t("insights.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : insights.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            <p className="mt-3 text-sm font-medium">{t("insights.empty.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("insights.empty.desc")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {insights.map((i) => {
              const style = TYPE_STYLE[i.insight_type] ?? { Icon: Lightbulb, cls: "text-muted-foreground bg-muted/30 border-border" };
              const Icon = style.Icon;
              const pending = apply.isPending && apply.variables === i.id;
              const copy = pickCopy(i.metrics ?? {}, lang);
              const headline = copy?.headline ?? i.title;
              const why = copy?.why ?? i.description;
              const what = copy?.what_to_do;
              const techOpen = openTech[i.id];
              return (
                <div key={i.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${style.cls}`}>
                      <Icon className="mr-1 h-3 w-3" />
                      {humanType(i.insight_type)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(i.confidence * 100)}% {t("insights.confidence")}
                    </Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(i.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{headline}</p>
                  <div className="mt-2 space-y-1.5 text-xs">
                    <div>
                      <span className="font-medium text-muted-foreground">{t("insights.why")}: </span>
                      <span className="text-foreground/90">{why}</span>
                    </div>
                    {what && (
                      <div>
                        <span className="font-medium text-muted-foreground">{t("insights.what")}: </span>
                        <span className="text-foreground/90">{what}</span>
                      </div>
                    )}
                  </div>
                  {i.expected_impact && (
                    <p className="mt-2 text-[11px] font-medium text-primary">💰 {i.expected_impact}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => apply.mutate(i.id)} disabled={pending}>
                      {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                      {t("insights.apply")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(i.id)} disabled={dismiss.isPending}>
                      <X className="mr-1 h-3.5 w-3.5" /> {t("insights.dismiss")}
                    </Button>
                    {copy && (
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setOpenTech((o) => ({ ...o, [i.id]: !o[i.id] }))}
                      >
                        <ChevronDown className={`h-3 w-3 transition-transform ${techOpen ? "rotate-180" : ""}`} />
                        {t("insights.tech")}
                      </button>
                    )}
                  </div>
                  {techOpen && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-[10px] text-muted-foreground">
{JSON.stringify({ title: i.title, description: i.description, metrics: i.metrics }, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
