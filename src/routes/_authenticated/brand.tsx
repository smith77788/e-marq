import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
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
  const { tenant: tenantId } = useSearch({ from: "/_authenticated/brand" });
  const { user, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();

  const { data: tenants } = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-select first tenant if none in URL
  useEffect(() => {
    if (!tenantId && tenants && tenants.length > 0) {
      navigate({ to: "/brand", search: { tenant: tenants[0].id }, replace: true });
    }
  }, [tenantId, tenants, navigate]);

  const current = tenants?.find((t) => t.id === tenantId);

  if (loading) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  if (!tenants || tenants.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>У вас ще немає бренду</CardTitle>
          <CardDescription>
            Попросіть супер-адміністратора створити бренд і призначити вас власником.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!current) {
    return <p className="text-sm text-muted-foreground">Завантажую бренд…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{current.name}</h1>
            <Badge variant="outline" className="font-mono text-[10px]">/{current.slug}</Badge>
            <Badge variant="outline" className="border-success/40 text-success text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {t("brand.live")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("brand.missionSubtitle")}
          </p>
        </div>
        {tenants.length > 1 && (
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={tenantId}
            onChange={(e) => navigate({ to: "/brand", search: { tenant: e.target.value } })}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <SetupChecklist tenantId={current.id} tenantSlug={current.slug} />

      <PlanUsageCard tenantId={current.id} />

      <OwnerTelegramBindCard tenantId={current.id} tenantSlug={current.slug} />

      <DnTradeIntegrationCard tenantId={current.id} />

      <CockpitHero tenantId={current.id} />

      <AnalyticsWindowProvider initial={30}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("brand.revenuePerf")}</h2>
          <AnalyticsWindowToggle />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><RevenueTrendChart tenantId={current.id} /></div>
          <FunnelChart tenantId={current.id} />
        </div>

        <KpiDashboard tenantId={current.id} />
      </AnalyticsWindowProvider>

      <div className="grid gap-4 lg:grid-cols-2">
        <LifecycleDistribution tenantId={current.id} />
        <CohortRetention tenantId={current.id} />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("brand.autonomousFleet")}</h2>

      <AgentHealthHeatmap tenantId={current.id} />

      <RevenueFeed tenantId={current.id} />

      <InsightsPanel tenantId={current.id} />

      <AgentTimeline tenantId={current.id} />

      <MemoryInspector tenantId={current.id} />

      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("brand.customersChannels")}</h2>

      <TopCustomers tenantId={current.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CustomerRoster tenantId={current.id} />
        <ChannelSetup tenantId={current.id} tenantSlug={current.slug} />
      </div>

      <IntegrationGuide tenantSlug={current.slug} />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Магазин і каталог
          </CardTitle>
          <CardDescription className="text-xs">
            Ваш публічний магазин: <Link to="/s/$slug" params={{ slug: current.slug }} className="text-primary hover:underline">/s/{current.slug}</Link>. Товарами та замовленнями керуйте у розділі бренду.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
