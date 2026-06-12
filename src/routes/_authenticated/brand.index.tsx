import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Clock, Database, Receipt, Settings, ShieldAlert, ShoppingBag, Store, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CockpitSkeleton } from "@/components/ui/cockpit-skeleton";
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
import { AcosLoopSummary } from "@/components/owner/AcosLoopSummary";
import { AskPinsBoard } from "@/components/owner/AskPinsBoard";
import { FunnelChart } from "@/components/owner/FunnelChart";
import { CohortRetention } from "@/components/owner/CohortRetention";
import { AgentHealthHeatmap } from "@/components/owner/AgentHealthHeatmap";
import { LifecycleDistribution } from "@/components/owner/LifecycleDistribution";
import { PlanUsageCard } from "@/components/owner/PlanUsageCard";
import { OwnerTelegramBindCard } from "@/components/owner/OwnerTelegramBindCard";
import { DnTradeIntegrationCard } from "@/components/owner/DnTradeIntegrationCard";
import { SeedDemoButton } from "@/components/owner/SeedDemoButton";
import { ACOSStats } from "@/components/owner/ACOSStats";
import { RealtimeRevenuePulse } from "@/components/owner/RealtimeRevenuePulse";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandPage,
});

function BrandPage() {
  const { tenant: tenantSearchId } = useSearch({ from: "/_authenticated/brand/" });
  const { loading: authLoading } = useAuth();
  useT();
  const navigate = useNavigate();
  const { tenants, current, currentTenantId, setCurrentTenantId, loading } = useTenantContext();

  // Sync ?tenant=… in URL with the global tenant context (in either direction).
  useEffect(() => {
    if (loading) return;
    if (tenantSearchId && tenantSearchId !== currentTenantId) {
      const found = tenants.find((tt) => tt.tenant_id === tenantSearchId);
      if (found) {
        setCurrentTenantId(tenantSearchId);
        return;
      }
    }
    if (!tenantSearchId && currentTenantId) {
      void navigate({
        to: "/brand",
        search: { tenant: currentTenantId },
        replace: true,
      });
    }
  }, [tenantSearchId, currentTenantId, tenants, loading, navigate, setCurrentTenantId]);

  // Modern shimmer skeleton — instead of plain "Завантаження…" text
  if (authLoading || loading) {
    return <CockpitSkeleton variant="owner" />;
  }

  if (!tenants || tenants.length === 0) {
    return (
      <Card className="fade-in-soft">
        <CardHeader>
          <CardTitle>Створіть свій перший бренд</CardTitle>
          <CardDescription>
            Створіть бренд за хвилину. Активація — до 24 годин після перевірки супер-адміном. Поки
            чекаєте — можна додати товари та підключити інтеграції.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap gap-2 px-6 pb-6">
          <Button asChild>
            <Link to="/onboarding">
              <Wand2 className="mr-1.5 h-4 w-4" />
              Створити бренд
            </Link>
          </Button>
        </div>
      </Card>
    );
  }

  if (!current) {
    return <CockpitSkeleton variant="owner" />;
  }

  return (
    <BrandCockpit
      currentTenantId={current.tenant_id}
      currentTenantName={current.tenant_name}
      currentTenantSlug={current.tenant_slug}
    />
  );
}

function BrandCockpit({
  currentTenantId,
  currentTenantName,
  currentTenantSlug,
}: {
  currentTenantId: string;
  currentTenantName: string;
  currentTenantSlug: string;
}) {
  const { t } = useT();

  const verification = useQuery({
    queryKey: ["tenant-verification", currentTenantId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("status, rejection_reason")
        .eq("id", currentTenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const isPending = verification.data?.status === "pending";
  const isRejected =
    verification.data?.status === "suspended" && !!verification.data?.rejection_reason;

  return (
    <div className="reveal-stagger space-y-6">
      {isPending && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" />
              Бренд активний — верифікацію можна пройти пізніше
            </CardTitle>
            <CardDescription>
              Усі функції доступні з першої секунди: підключайте Shopify, CSV, Telegram, додавайте
              товари. Бейдж «Перевірено» від нашої команди потім підніме ліміти й активує кастомний
              домен.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-wrap gap-2 px-6 pb-6">
            <Button asChild size="sm" variant="outline">
              <Link to="/brand/integrations" search={{ tenant: currentTenantId }}>
                Підключити джерело даних
              </Link>
            </Button>
          </div>
        </Card>
      )}
      {isRejected && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              Заявку відхилено
            </CardTitle>
            <CardDescription>
              <strong className="text-foreground">Причина:</strong>{" "}
              {verification.data?.rejection_reason}. Зв&apos;яжіться з підтримкою або створіть новий
              бренд із оновленими даними.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <BrandCockpitInner
        currentTenantId={currentTenantId}
        currentTenantName={currentTenantName}
        currentTenantSlug={currentTenantSlug}
        t={t}
      />
    </div>
  );
}

function BrandCockpitInner({
  currentTenantId,
  currentTenantName,
  currentTenantSlug,
  t,
}: {
  currentTenantId: string;
  currentTenantName: string;
  currentTenantSlug: string;
  t: ReturnType<typeof useT>["t"];
}) {
  const current = {
    tenant_id: currentTenantId,
    tenant_name: currentTenantName,
    tenant_slug: currentTenantSlug,
  };
  return (
    <>
      <div className="reveal-stagger space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
                <Bot className="h-4 w-4 text-primary-foreground" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {current.tenant_name}
              </h1>
              <Badge variant="outline" className="font-mono text-[10px]">
                /{current.tenant_slug}
              </Badge>
              <Badge variant="outline" className="border-success/40 text-success text-[10px]">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {t("brand.live")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("brand.missionSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/brand/site-builder" search={{ tenant: current.tenant_id }}>
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

        <QuickConnectBanner tenantId={current.tenant_id} />

        <SeedDemoButton tenantId={current.tenant_id} />

        <SetupReadinessCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

        <PlanUsageCard tenantId={current.tenant_id} />

        <OwnerTelegramBindCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

        <DnTradeIntegrationCardGuard tenantId={current.tenant_id} />

        <CockpitHero tenantId={current.tenant_id} />

        <RealtimeRevenuePulse tenantId={current.tenant_id} />

        <ACOSStats tenantId={current.tenant_id} />

        <AcosLoopSummary tenantId={current.tenant_id} />

        <AskPinsBoard />

        <AnalyticsWindowProvider initial={30}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("brand.revenuePerf")}
            </h2>
            <AnalyticsWindowToggle />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueTrendChart tenantId={current.tenant_id} />
            </div>
            <FunnelChart tenantId={current.tenant_id} />
          </div>

          <KpiDashboard tenantId={current.tenant_id} />
        </AnalyticsWindowProvider>

        <div className="grid gap-4 lg:grid-cols-2">
          <LifecycleDistribution tenantId={current.tenant_id} />
          <CohortRetention tenantId={current.tenant_id} />
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("brand.autonomousFleet")}
        </h2>

        <AgentHealthHeatmap tenantId={current.tenant_id} />

        <RevenueFeed tenantId={current.tenant_id} />

        <section id="insights" className="scroll-mt-24 space-y-6">
          <InsightsPanel tenantId={current.tenant_id} />
        </section>

        <AgentTimeline tenantId={current.tenant_id} />

        <MemoryInspector tenantId={current.tenant_id} />

        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("brand.customersChannels")}
        </h2>

        <section id="customers" className="scroll-mt-24 space-y-6">
          <TopCustomers tenantId={current.tenant_id} />
          <div className="grid gap-6 lg:grid-cols-2">
            <CustomerRoster tenantId={current.tenant_id} />
            <ChannelSetup tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />
          </div>
        </section>

        <section id="channels" className="scroll-mt-24 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("sb.channels")}
          </h2>
          <ChannelSetup tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />
        </section>

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
              <Link
                to="/brand/site-builder"
                search={{ tenant: current.tenant_id }}
                className="text-primary hover:underline"
              >
                Конструкторі сайту
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}

function QuickConnectBanner({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quick-connect-check", tenantId],
    queryFn: async () => {
      const [intResult, prodResult] = await Promise.all([
        supabase
          .from("tenant_integrations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
      ]);
      return {
        hasIntegrations: (intResult.count ?? 0) > 0,
        hasProducts: (prodResult.count ?? 0) > 0,
      };
    },
  });

  if (isLoading || !data) return null;
  if (data.hasIntegrations || data.hasProducts) return null;

  const providers = [
    { id: "shopify", name: "Shopify", Icon: ShoppingBag, desc: "Магазин на Shopify" },
    { id: "woocommerce", name: "WooCommerce", Icon: Store, desc: "WordPress + WooCommerce" },
    { id: "dntrade", name: "DN Trade", Icon: Database, desc: "DN Trade ERP" },
    { id: "poster", name: "Poster POS", Icon: Receipt, desc: "Poster касова система" },
  ];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Підключіть джерело даних за 2 хвилини</CardTitle>
        <CardDescription>
          Імпортуйте товари та клієнтів автоматично. Виберіть платформу — ми запросимо тільки
          необхідні дані.
        </CardDescription>
      </CardHeader>
      <div className="grid grid-cols-2 gap-2 px-6 pb-4 sm:grid-cols-4">
        {providers.map(({ id, name, Icon, desc }) => (
          <Link
            key={id}
            to="/brand/integrations"
            search={{ tenant: tenantId }}
            className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-card p-3 text-center transition hover:border-primary/50 hover:bg-primary/5"
          >
            <Icon className="h-6 w-6 text-primary" />
            <span className="text-xs font-medium leading-tight">{name}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{desc}</span>
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2 px-6 pb-5">
        <Button asChild size="sm">
          <Link to="/brand/integrations" search={{ tenant: tenantId }}>
            Переглянути всі інтеграції
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/brand/products" search={{ tenant: tenantId }}>
            Додати товари вручну
          </Link>
        </Button>
      </div>
    </Card>
  );
}

/**
 * Render DnTradeIntegrationCard only when a DN Trade integration row already exists.
 * Otherwise show a small CTA pointing to the integrations hub — keeps the dashboard
 * uncluttered for tenants that don't use DN Trade.
 */
function DnTradeIntegrationCardGuard({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dntrade-integration-exists", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_integrations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("provider", "dntrade")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  if (isLoading) return null;
  if (data) return <DnTradeIntegrationCard tenantId={tenantId} />;
  return null;
}
