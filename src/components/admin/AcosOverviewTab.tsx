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
    label: "Inventory",
    icon: Boxes,
    types: ["stockout_predicted", "restock_alert"],
    description: "Stockout forecasts & reorder triggers",
  },
  {
    key: "crm",
    label: "CRM / Cohorts",
    icon: Users,
    types: ["churn_risk", "cohort_segmentation", "winback_triggered"],
    description: "Churn risk VIPs & winback touches",
  },
  {
    key: "ltv",
    label: "LTV Tiers",
    icon: Gem,
    types: ["ltv_score", "loyalty_tier"],
    description: "Lifetime value scoring & loyalty",
  },
  {
    key: "promotions",
    label: "Auto-Promotions",
    icon: Package,
    types: ["auto_promotion", "bundle_recommendation"],
    description: "Smart bundles & promo suggestions",
  },
  {
    key: "pricing",
    label: "Pricing",
    icon: TrendingUp,
    types: ["pricing_recommendation", "elasticity_signal"],
    description: "Elasticity-driven price tuning",
  },
  {
    key: "search",
    label: "Search & SEO",
    icon: Search,
    types: ["search_gap", "seo_opportunity"],
    description: "SEO opportunities & content gaps",
  },
  {
    key: "recovery",
    label: "Cart Recovery",
    icon: ShoppingCart,
    types: ["aov_leak", "cart_recovery", "checkout_friction"],
    description: "AOV leaks & abandoned carts",
  },
  {
    key: "monitoring",
    label: "Anomalies",
    icon: AlertTriangle,
    types: ["anomaly_revenue_dip", "anomaly_conversion_drop"],
    description: "Revenue & funnel anomalies",
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
                ACOS Command Center
                <Badge variant="outline" className="text-[10px]">
                  7d
                </Badge>
              </CardTitle>
              <CardDescription>
                {insights.length} insights · {newCount} new · {inReviewCount} pending approval
                {highRiskCount > 0 && ` · ${highRiskCount} high-risk`}
              </CardDescription>
            </div>
            {insights.length > 0 && (
              <Link
                to="/admin/tenants/$tenantId"
                params={{ tenantId }}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                View all →
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {insightsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading insights…</p>
          ) : insights.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">
                No insights yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                ACOS agents haven't run for this tenant. Generate synthetic data or connect a real
                data source — agents will start writing insights into the approval queue.
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
          <CardTitle className="text-base">What ACOS does for this brand</CardTitle>
          <CardDescription>
            Connect once. AI agents run on a schedule, surface revenue opportunities, and queue
            them for one-click approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              1
            </div>
            <p>
              <span className="font-medium text-foreground">Agents analyze</span> — daily cron
              jobs scan orders, customers, products, and events for churn risk, stockouts, AOV
              leaks, pricing elasticity, SEO gaps.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              2
            </div>
            <p>
              <span className="font-medium text-foreground">Insights queue up</span> — each finding
              lands here with an expected impact, confidence score, and suggested action.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              3
            </div>
            <p>
              <span className="font-medium text-foreground">You approve in one click</span> — ACOS
              applies the action (winback touch, restock, promo, price tune) and tracks the
              actual revenue impact.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              4
            </div>
            <p>
              <span className="font-medium text-foreground">Memory loop learns</span> — patterns
              that worked get boosted, ones that failed get blocked. The system gets smarter every
              week.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
