import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcosAgentRuns } from "@/components/admin/AcosAgentRuns";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useT, tStatic } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/agents/live")({
  head: () => ({
    meta: [
      { title: tStatic("ag.liveTitle") },
      { name: "description", content: tStatic("ag.liveDesc") },
    ],
  }),
  component: AgentsLivePage,
});

const LIVE_AGENT_IDS = [
  "onboarding",
  "churn-risk",
  "stockout",
  "aov-leak",
  "search-gap",
  "aov-optimizer",
  "price-optimizer",
  "price-revert",
  "bot-quality",
  "segmentation",
  "memory-feedback",
  "margin-optimizer",
  "ltv-predictor",
  "cart-recovery",
  "anomaly-detector",
  "morning-brief",
  "bundle-recommender",
  "promo-fatigue",
  "promo-portfolio",
  "discount-elasticity",
  "predictive-pricing",
  "cohort-engine",
  "attribution",
  "funnel-healer",
  "browse-abandonment",
  "second-order-nurture",
  "bot-sequences",
  "broadcast-composer",
  "best-time-to-send",
  "csat-dispatcher",
  "nurture-roi",
  "seo-rewriter",
  "content-velocity",
  "ugc-harvester",
  "search-intent-miner",
  "programmatic-seo",
  "customer-segments-auto",
  "loyalty-tiers",
  "product-affinity",
  "customer-churn-predictor",
  "first-order-funnel",
  "inventory-forecast",
  "restock-alert",
  "anti-fraud",
  "action-watchdog",
  "conflict-resolver",
  "social-proof-live",
  "broadcast-roi",
  "winback-roi",
  "elasticity-meta-loop",
  "learning-loop-monitor",
  "notification-router",
  "daily-digest-v2",
  "owner-playbook",
  "meta-prior-injector",
  "autonomous-seo-loop",
  "shipping-optimizer",
  "return-predictor",
  "vip-concierge",
  "review-velocity",
  "payment-retry",
  "geo-demand",
  "time-of-day-pricer",
  "refund-risk",
  "lifecycle-trigger-tuner",
  "inventory-rebalance",
  "brand-profile",
  "catalog-enricher",
  "margin-estimator",
  "customer-voice",
  "channel-discovery",
  "seasonality-detector",
  "integration-scout",
  "data-gap-auditor",
] as const;

function AgentsLivePage() {
  const { current, loading } = useTenantContext();
  const { t } = useT();
  const [running, setRunning] = useState(false);

  const tenantId = current?.tenant_id ?? null;

  async function runAll() {
    if (!tenantId) return;
    setRunning(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("not signed in");

      const results = await Promise.allSettled(
        LIVE_AGENT_IDS.map(async (agentId) => {
          const res = await fetch(`/hooks/agents/${agentId}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ tenant_id: tenantId }),
          });
          const json = (await res.json().catch(() => ({}))) as { error?: string; insights_created?: number };
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          return json.insights_created ?? 0;
        }),
      );

      const totalCreated = results.reduce((sum, result) => {
        return sum + (result.status === "fulfilled" ? result.value : 0);
      }, 0);

      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (failedCount === LIVE_AGENT_IDS.length) {
        throw new Error("all agents failed");
      }

      toast.success(
        failedCount > 0
          ? `${t("ag.liveTriggered")} (+${totalCreated}) · ${failedCount} failed`
          : `${t("ag.liveTriggered")} (+${totalCreated})`,
      );
    } catch (e) {
      toast.error(`${t("ag.liveFailed")} ${e instanceof Error ? e.message : ""}`);
      console.error(e);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Activity className="mr-1 h-3 w-3" /> {t("ag.liveBadge")}
          </Badge>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("ag.liveTitle")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("ag.liveDesc")}
          </p>
        </div>
        <Button onClick={runAll} disabled={running || !tenantId} size="lg">
          {running ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("ag.liveRunning")}
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" /> {t("ag.liveRunAll")}
            </>
          )}
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">{t("ag.liveLoading")}</CardContent>
        </Card>
      ) : !tenantId ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("ag.liveNoTenantTitle")}</CardTitle>
            <CardDescription>{t("ag.liveNoTenantDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <AcosAgentRuns tenantId={tenantId} />
      )}
    </div>
  );
}
