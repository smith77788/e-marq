import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Boxes,
  Check,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { MSG } from "@/lib/glossary";

type Props = { tenantId: string };

type InsightRow = {
  id: string;
  insight_type: string;
  affected_layer: string | null;
  title: string;
  description: string;
  expected_impact: string | null;
  confidence: number;
  risk_level: string;
  status: string;
  metrics: Record<string, unknown>;
  created_at: string;
};

const RISK_STYLES: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-warning/15 text-warning-foreground border-warning/40",
  low: "bg-muted text-muted-foreground border-border",
};

const RISK_LABEL: Record<string, string> = {
  high: "високий ризик",
  medium: "середній ризик",
  low: "низький ризик",
};

const INSIGHT_TYPE_LABEL: Record<string, string> = {
  churn_risk: "ризик втратити клієнта",
  stockout_predicted: "товар скоро закінчиться",
  aov_leak: "втрати в чеку",
  search_gap: "клієнти не знаходять",
  cart_recovery: "повернення кошика",
  cohort_segmentation: "групування клієнтів",
  winback_triggered: "повернення клієнта",
  ltv_score: "цінність клієнта",
  loyalty_tier: "програма лояльності",
  auto_promotion: "авто-промо",
  bundle_recommendation: "набір товарів",
  pricing_recommendation: "підбір ціни",
  elasticity_signal: "реакція на ціну",
  seo_opportunity: "можливість для SEO",
  checkout_friction: "перешкоди при оплаті",
  anomaly_revenue_dip: "падіння виторгу",
  anomaly_conversion_drop: "падіння конверсії",
  restock_alert: "час поповнити склад",
  abandoned_cart: "покинутий кошик",
  low_engagement_product: "слабкий інтерес до товару",
};

const LAYER_LABEL: Record<string, string> = {
  inventory: "склад",
  crm: "клієнти",
  ltv: "цінність клієнтів",
  promotions: "промо",
  pricing: "ціни",
  search: "пошук та SEO",
  recovery: "кошики",
  monitoring: "аномалії",
};

const STATUS_LABEL: Record<string, string> = {
  new: "нові",
  in_review: "на схваленні",
  approved: "схвалені",
  applied: "виконані",
  dismissed: "сховані",
  all: "усі",
};

const TYPE_ICONS: Record<string, typeof Users> = {
  churn_risk: Users,
  stockout_predicted: Boxes,
  aov_leak: ShoppingCart,
  search_gap: Search,
};

const SINGLE_AGENTS: { id: string; label: string }[] = [
  { id: "churn-risk", label: "Ризик втрати клієнтів" },
  { id: "stockout", label: "Закінчення товару" },
  { id: "aov-leak", label: "Втрати в чеку" },
  { id: "search-gap", label: "Прогалини у пошуку" },
];

function humanType(t: string) {
  return INSIGHT_TYPE_LABEL[t] ?? t.replace(/_/g, " ");
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
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    success?: boolean;
    error?: string;
    details?: string;
  };
  if (!res.ok || json.success === false) {
    throw new Error(
      typeof json.details === "string"
        ? json.details
        : typeof json.error === "string"
          ? json.error
          : MSG.errGeneric,
    );
  }
  return json;
}

export function AcosInsightsQueue({ tenantId }: Props) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<
    "all" | "new" | "in_review" | "approved" | "applied"
  >("new");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["acos-insights-queue", tenantId, statusFilter, typeFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("ai_insights")
        .select(
          "id, insight_type, affected_layer, title, description, expected_impact, confidence, risk_level, status, metrics, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("confidence", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(150);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (typeFilter !== "all") q = q.eq("insight_type", typeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
    refetchInterval: 30_000,
  });

  const runAll = useMutation({
    mutationFn: () => authedFetch("/hooks/agents/run-all", { tenant_id: tenantId }),
    onSuccess: (r) => {
      toast.success(
        `Готово · усі ШІ-помічники відпрацювали. Нових підказок: ${r.insights_created ?? 0}`,
      );
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-agent-runs", tenantId] });
    },
    onError: (e: Error) => toast.error(`Не вдалося запустити: ${e.message || MSG.errGeneric}`),
  });

  const runOne = useMutation({
    mutationFn: (agent: string) => authedFetch(`/hooks/agents/${agent}`, { tenant_id: tenantId }),
    onSuccess: (r, agent) => {
      const label = SINGLE_AGENTS.find((a) => a.id === agent)?.label ?? agent;
      toast.success(
        `Готово · «${label}» завершив роботу. Нових підказок: ${r.insights_created ?? 0}`,
      );
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-agent-runs", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errGeneric),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("ai_insights").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "approved"
          ? MSG.approved
          : vars.status === "dismissed"
            ? MSG.dismissed
            : MSG.updated,
      );
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-insights", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errGeneric),
  });

  const applyAction = useMutation({
    mutationFn: (insightId: string) =>
      authedFetch("/hooks/actions/apply", { insight_id: insightId }),
    onSuccess: () => {
      toast.success(MSG.applied);
      qc.invalidateQueries({ queryKey: ["acos-insights-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["acos-actions", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errApply),
  });

  const counts = {
    new: insights.filter((i) => i.status === "new").length,
    in_review: insights.filter((i) => i.status === "in_review").length,
    approved: insights.filter((i) => i.status === "approved").length,
    applied: insights.filter((i) => i.status === "applied").length,
    high: insights.filter((i) => i.risk_level === "high").length,
  };

  const types = Array.from(new Set(insights.map((i) => i.insight_type)));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Черга підказок
            </CardTitle>
            <CardDescription>
              Перегляньте, що знайшли ШІ-помічники, і схваліть дії. Оновлюється кожні 30 секунд.
              {counts.high > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                  <ShieldAlert className="h-3 w-3" /> {counts.high} високого ризику
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => runAll.mutate()} disabled={runAll.isPending} size="sm">
              {runAll.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-3.5 w-3.5" />
              )}
              Запустити всіх ШІ-помічників
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SINGLE_AGENTS.map((a) => (
            <Button
              key={a.id}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={runOne.isPending}
              onClick={() => runOne.mutate(a.id)}
            >
              {runOne.isPending && runOne.variables === a.id ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Play className="mr-1 h-3 w-3" />
              )}
              {a.label}
            </Button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(["new", "in_review", "approved", "applied", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {STATUS_LABEL[f] ?? f}
                {f !== "all" && counts[f] > 0 && (
                  <span className="ml-1.5 opacity-70">{counts[f]}</span>
                )}
              </button>
            ))}
          </div>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setTypeFilter("all")}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                  typeFilter === "all"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                }`}
              >
                Усі типи
              </button>
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    typeFilter === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {humanType(t)}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{MSG.loading}</p>
        ) : insights.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">Підказок за вибраним фільтром поки немає</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Натисніть «Запустити всіх ШІ-помічників» — система перевірить ризики втрати клієнтів,
              закінчення товарів, втрати в чеку і прогалини у пошуку.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[680px] pr-3">
            <div className="space-y-2">
              {insights.map((ins) => {
                const Icon = TYPE_ICONS[ins.insight_type] ?? Sparkles;
                const m = ins.metrics as Record<string, unknown>;
                return (
                  <div key={ins.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${RISK_STYLES[ins.risk_level] ?? ""}`}
                      >
                        {RISK_LABEL[ins.risk_level] ?? ins.risk_level}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {humanType(ins.insight_type)}
                      </Badge>
                      {ins.affected_layer && (
                        <Badge variant="secondary" className="text-[10px]">
                          {LAYER_LABEL[ins.affected_layer] ?? ins.affected_layer}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        впевненість {(ins.confidence * 100).toFixed(0)}%
                      </Badge>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(ins.created_at), {
                          addSuffix: true,
                          locale: uk,
                        })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{ins.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ins.description}</p>
                    {ins.expected_impact && (
                      <p className="mt-1 text-xs font-medium text-primary">
                        → {ins.expected_impact}
                      </p>
                    )}
                    <MetricsLine type={ins.insight_type} m={m} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(ins.status === "new" || ins.status === "in_review") && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            disabled={updateStatus.isPending}
                            onClick={() => updateStatus.mutate({ id: ins.id, status: "approved" })}
                          >
                            <Check className="mr-1 h-3 w-3" /> Схвалити
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={updateStatus.isPending}
                            onClick={() => updateStatus.mutate({ id: ins.id, status: "dismissed" })}
                          >
                            <X className="mr-1 h-3 w-3" /> Сховати
                          </Button>
                        </>
                      )}
                      {ins.status === "approved" && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          disabled={applyAction.isPending}
                          onClick={() => applyAction.mutate(ins.id)}
                        >
                          {applyAction.isPending && applyAction.variables === ins.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="mr-1 h-3 w-3" />
                          )}
                          Виконати дію
                        </Button>
                      )}
                      {(ins.status === "applied" || ins.status === "dismissed") && (
                        <Badge variant="outline" className="text-[10px]">
                          {ins.status === "applied" ? "виконано" : "сховано"}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsLine({ type, m }: { type: string; m: Record<string, unknown> }) {
  const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  if (type === "churn_risk") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div>
          <span className="text-foreground">{num("order_count")}</span> замовлень
        </div>
        <div>
          {Math.round(((num("total_spent_cents") ?? 0) as number) / 100).toLocaleString("uk-UA")} ₴
          загалом
        </div>
        <div>{num("recency_days")?.toFixed(0)} днів мовчить</div>
        <div>{num("drift_ratio")?.toFixed(2)}× довше звичайного</div>
      </div>
    );
  }
  if (type === "stockout_predicted") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div>
          <span className="text-foreground">{num("stock")}</span> на складі
        </div>
        <div>{num("velocity_per_day")?.toFixed(2)} продажів/день</div>
        <div>{num("days_of_supply")?.toFixed(1)} днів вистачить</div>
        <div>замовити {num("suggested_reorder_qty")} шт</div>
      </div>
    );
  }
  if (type === "aov_leak") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div>
          <span className="text-foreground">{num("abandoned_sessions")}</span> покинули
        </div>
        <div>{num("abandoned_checkouts")} застрягли на оплаті</div>
        <div>можна повернути ~{num("recoverable_sessions")}</div>
        <div>
          {Math.round(((num("recoverable_revenue_cents") ?? 0) as number) / 100).toLocaleString(
            "uk-UA",
          )}{" "}
          ₴ потенціал
        </div>
      </div>
    );
  }
  if (type === "search_gap") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
        <div>«{str("search_term")}»</div>
        <div>{num("searches_zero_results")} пошуків без результатів</div>
        <div>{((num("miss_rate") ?? 0) * 100).toFixed(0)}% запитів без відповіді</div>
      </div>
    );
  }
  return null;
}
