import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { Bot, Settings, Wand2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { RevenueFeed } from "@/components/owner/RevenueFeed";
import { CustomerRoster } from "@/components/owner/CustomerRoster";
import { ChannelSetup } from "@/components/owner/ChannelSetup";
import { InsightsPanel } from "@/components/owner/InsightsPanel";
import { IntegrationGuide } from "@/components/owner/IntegrationGuide";
import { KpiDashboard } from "@/components/owner/KpiDashboard";
import { RevenueTrendChart } from "@/components/owner/RevenueTrendChart";
import { TopCustomers } from "@/components/owner/TopCustomers";
import { AgentTimeline } from "@/components/owner/AgentTimeline";
import { MemoryInspector } from "@/components/owner/MemoryInspector";
import { SetupChecklist } from "@/components/owner/SetupChecklist";
import { SetupReadinessCard } from "@/components/owner/SetupReadinessCard";
import { AnalyticsWindowProvider, AnalyticsWindowToggle } from "@/components/owner/AnalyticsWindow";
import { CockpitHero } from "@/components/owner/CockpitHero";
import { FunnelChart } from "@/components/owner/FunnelChart";
import { CohortRetention } from "@/components/owner/CohortRetention";
import { AgentHealthHeatmap } from "@/components/owner/AgentHealthHeatmap";
import { LifecycleDistribution } from "@/components/owner/LifecycleDistribution";
import { PlanUsageCard } from "@/components/owner/PlanUsageCard";
import { OwnerTelegramBindCard } from "@/components/owner/OwnerTelegramBindCard";
import { DnTradeIntegrationCard } from "@/components/owner/DnTradeIntegrationCard";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandPage,
});

function BrandPage() {
  const { tenant: tenantSearchId } = useSearch({ from: "/_authenticated/brand" });
  const { loading: authLoading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const { tenants, current, currentTenantId, setCurrentTenantId, loading } = useTenantContext();

  // Sync ?tenant=… in URL with the global tenant context (in either direction).
  useEffect(() => {
    if (loading) return;
    // 1) URL has tenant → activate it in context
    if (tenantSearchId && tenantSearchId !== currentTenantId) {
      const found = tenants.find((tt) => tt.tenant_id === tenantSearchId);
      if (found) {
        setCurrentTenantId(tenantSearchId);
        return;
      }
    }
    // 2) URL has no tenant but context does → push to URL (replace)
    if (!tenantSearchId && currentTenantId) {
      void navigate({
        to: "/brand",
        search: { tenant: currentTenantId },
        replace: true,
      });
    }
  }, [tenantSearchId, currentTenantId, tenants, loading, navigate, setCurrentTenantId]);

  if (authLoading || loading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  if (!tenants || tenants.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("brand.noBrandTitle")}</CardTitle>
          <CardDescription>{t("brand.noBrandDesc")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!current) {
    return <p className="text-sm text-muted-foreground">{t("brand.loadingBrand")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{current.tenant_name}</h1>
            <Badge variant="outline" className="font-mono text-[10px]">/{current.tenant_slug}</Badge>
            <Badge variant="outline" className="border-success/40 text-success text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {t("brand.live")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("brand.missionSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/brand/site-builder">
              <Wand2 className="mr-1.5 h-3.5 w-3.5 text-accent" />
              Конструктор сайту
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/s/$slug" params={{ slug: current.tenant_slug }}>
              <Settings className="mr-1.5 h-3.5 w-3.5 text-primary" />
              Відкрити магазин
            </Link>
          </Button>
        </div>
      </div>

      <SetupChecklist tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

      <SetupReadinessCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

      <PlanUsageCard tenantId={current.tenant_id} />

      <OwnerTelegramBindCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

      <DnTradeIntegrationCard tenantId={current.tenant_id} />

      <CockpitHero tenantId={current.tenant_id} />

      <AnalyticsWindowProvider initial={30}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("brand.revenuePerf")}</h2>
          <AnalyticsWindowToggle />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><RevenueTrendChart tenantId={current.tenant_id} /></div>
          <FunnelChart tenantId={current.tenant_id} />
        </div>

        <KpiDashboard tenantId={current.tenant_id} />
      </AnalyticsWindowProvider>

      <div className="grid gap-4 lg:grid-cols-2">
        <LifecycleDistribution tenantId={current.tenant_id} />
        <CohortRetention tenantId={current.tenant_id} />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("brand.autonomousFleet")}</h2>

      <AgentHealthHeatmap tenantId={current.tenant_id} />

      <RevenueFeed tenantId={current.tenant_id} />

      <section id="insights" className="scroll-mt-24 space-y-6">
        <InsightsPanel tenantId={current.tenant_id} />
      </section>

      <AgentTimeline tenantId={current.tenant_id} />

      <MemoryInspector tenantId={current.tenant_id} />

      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("brand.customersChannels")}</h2>

      <section id="customers" className="scroll-mt-24 space-y-6">
        <TopCustomers tenantId={current.tenant_id} />
        <div className="grid gap-6 lg:grid-cols-2">
          <CustomerRoster tenantId={current.tenant_id} />
          <ChannelSetup tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />
        </div>
      </section>

      <section id="channels" className="scroll-mt-24" aria-hidden />

      <IntegrationGuide tenantSlug={current.tenant_slug} />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Магазин і каталог
          </CardTitle>
          <CardDescription className="text-xs">
            Ваш публічний магазин:{" "}
            <Link
              to="/s/$slug"
              params={{ slug: current.tenant_slug }}
              className="text-primary hover:underline"
            >
              /s/{current.tenant_slug}
            </Link>
            . Дизайн, контент і колір магазину налаштовуйте у{" "}
            <Link to="/brand/site-builder" className="text-primary hover:underline">
              Конструкторі сайту
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
