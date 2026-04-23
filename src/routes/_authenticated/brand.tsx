import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Clock, Settings, ShieldAlert, Wand2 } from "lucide-react";
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
import { AskPinsBoard } from "@/components/owner/AskPinsBoard";
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
            Створіть бренд за хвилину — після перевірки супер-адміном він стане активним і ви
            отримаєте доступ до всіх інструментів.
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

  return <BrandCockpit currentTenantId={current.tenant_id} currentTenantName={current.tenant_name} currentTenantSlug={current.tenant_slug} />;
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
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-warning" />
              Бренд очікує верифікації
            </CardTitle>
            <CardDescription>
              Ми вже сповістили супер-адміна. Як тільки заявку підтвердять — ви отримаєте повний
              доступ до автоматизації, агентів та виплат. Поки що можна налаштувати каталог,
              канали, інтеграції.
            </CardDescription>
          </CardHeader>
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
              {verification.data?.rejection_reason}. Зв&apos;яжіться з підтримкою або створіть
              новий бренд із оновленими даними.
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
  const current = { tenant_id: currentTenantId, tenant_name: currentTenantName, tenant_slug: currentTenantSlug };
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

      <SetupReadinessCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

      <PlanUsageCard tenantId={current.tenant_id} />

      <OwnerTelegramBindCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} />

      <DnTradeIntegrationCard tenantId={current.tenant_id} />

      <CockpitHero tenantId={current.tenant_id} />

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
  );
}
