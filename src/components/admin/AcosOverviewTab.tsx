import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Boxes,
  Crown,
  Gem,
  Package,
  Search,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type LayerKey =
  | "inventory"
  | "crm"
  | "ltv"
  | "promotions"
  | "pricing"
  | "search"
  | "recovery"
  | "monitoring";

const LAYERS: {
  key: LayerKey;
  label: string;
  icon: typeof Package;
  types: string[];
  description: string;
}[] = [
  {
    key: "inventory",
    label: "Склад",
    icon: Boxes,
    types: ["stockout_predicted", "restock_alert"],
    description: "Прогноз зникнення товару та поповнення",
  },
  {
    key: "crm",
    label: "Клієнти / Когорти",
    icon: Users,
    types: ["churn_risk", "cohort_segmentation", "winback_triggered"],
    description: "VIP, що можуть піти, та повернення клієнтів",
  },
  {
    key: "ltv",
    label: "Цінність клієнтів",
    icon: Gem,
    types: ["ltv_score", "loyalty_tier"],
    description: "Оцінка цінності та програма лояльності",
  },
  {
    key: "promotions",
    label: "Авто-промо",
    icon: Package,
    types: ["auto_promotion", "bundle_recommendation"],
    description: "Розумні набори та промо-пропозиції",
  },
  {
    key: "pricing",
    label: "Ціни",
    icon: TrendingUp,
    types: ["pricing_recommendation", "elasticity_signal"],
    description: "Підбір цін за чутливістю покупців",
  },
  {
    key: "search",
    label: "Пошук та SEO",
    icon: Search,
    types: ["search_gap", "seo_opportunity"],
    description: "Можливості SEO та прогалини в контенті",
  },
  {
    key: "recovery",
    label: "Кошики",
    icon: ShoppingCart,
    types: ["aov_leak", "cart_recovery", "checkout_friction"],
    description: "Втрати чека та покинуті кошики",
  },
  {
    key: "monitoring",
    label: "Аномалії",
    icon: AlertTriangle,
    types: ["anomaly_revenue_dip", "anomaly_conversion_drop"],
    description: "Різкі падіння виторгу та конверсії",
  },
];

type InsightRow = {
  insight_type: string;
  status: string;
  risk_level: string;
  title: string;
  affected_layer: string | null;
  created_at: string;
};

export function AcosOverviewTab({ tenantId }: Props) {
  const insightsQuery = useQuery({
    queryKey: ["acos-insights", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ai_insights")
        .select("insight_type, status, risk_level, title, affected_layer, created_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as InsightRow[];
    },
    refetchInterval: 60_000,
  });

  const insights = insightsQuery.data ?? [];
  const newCount = insights.filter((i) => i.status === "new").length;
  const inReviewCount = insights.filter((i) => i.status === "in_review").length;
  const highRiskCount = insights.filter((i) => i.risk_level === "high").length;

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                Командний центр агентів
                <Badge variant="outline" className="text-[10px]">
                  7 днів
                </Badge>
              </CardTitle>
              <CardDescription>
                {insights.length} підказок · {newCount} нових · {inReviewCount} на схваленні
                {highRiskCount > 0 && ` · ${highRiskCount} високого ризику`}
              </CardDescription>
            </div>
            {insights.length > 0 && (
              <Link
                to="/admin/tenants/$tenantId"
                params={{ tenantId }}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Дивитись усі →
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {insightsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Завантажую підказки…</p>
          ) : insights.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">Поки що підказок немає</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Агенти ще не запускались для цього бренду. Згенеруйте демо-дані або підключіть
                реальне джерело — і агенти почнуть формувати підказки на схвалення.
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {LAYERS.map((layer) => {
              const layerInsights = insights.filter(
                (i) => layer.types.includes(i.insight_type) || i.affected_layer === layer.key,
              );
              const latest = layerInsights[0];
              const Icon = layer.icon;
              return (
                <div
                  key={layer.key}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-xs font-medium text-foreground">{layer.label}</span>
                    {layerInsights.length > 0 && (
                      <Badge variant="outline" className="ml-auto h-4 px-1 text-[9px]">
                        {layerInsights.length}
                      </Badge>
                    )}
                  </div>
                  {latest ? (
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">{latest.title}</p>
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground/70">
                      {layer.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Що система робить для цього бренду</CardTitle>
          <CardDescription>
            Підключіть один раз — агенти працюють за розкладом, знаходять можливості для виторгу і
            ставлять їх у чергу на ваше одне натискання «Так».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              1
            </div>
            <p>
              <span className="font-medium text-foreground">Агенти аналізують</span> — щоденно
              переглядають замовлення, клієнтів, товари та події, шукаючи ризик відтоку, зникнення
              товару, втрати в чеку, можливості ціни та SEO.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              2
            </div>
            <p>
              <span className="font-medium text-foreground">Підказки вишиковуються в чергу</span> —
              кожна знахідка має очікуваний ефект, рівень впевненості та готову дію.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              3
            </div>
            <p>
              <span className="font-medium text-foreground">Ви схвалюєте одним натисканням</span> —
              система виконує дію (повернення клієнта, поповнення, промо, зміна ціни) і відстежує
              реальний ефект у виторгу.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              4
            </div>
            <p>
              <span className="font-medium text-foreground">Памʼять навчається</span> — те, що
              спрацювало, повторюється; що ні — більше не пропонується. З кожним тижнем система стає
              точнішою саме під ваш бренд.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
