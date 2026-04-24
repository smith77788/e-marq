/**
 * Brand → Email marketing.
 *
 * Виділена сторінка email-каналу, що поєднує три розділи в табах:
 *   1. Кампанії       — створення/відправка masових розсилок (EmailCampaignsCard)
 *   2. Автоматизації  — увімкнення/вимкнення 5 автоматичних сценаріїв
 *   3. Налаштування   — домен відправника, DKIM/SPF (EmailDomainCard)
 *
 * Раніше ці блоки були розкидані по /brand/promotions та /brand/integrations —
 * тепер email має власний дім. Тенант береться з useTenantContext, що даєт нам
 * один й той самий switcher, що на інших сторінках бренду.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import { useTenantContext } from "@/hooks/useTenantContext";
import { EmailCampaignsCard } from "@/components/owner/EmailCampaignsCard";
import { EmailCampaignWizard } from "@/components/owner/EmailCampaignWizard";
import { EmailDomainCard } from "@/components/owner/EmailDomainCard";
import { EmailAutomationsCard } from "@/components/owner/EmailAutomationsCard";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/email")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandEmailPage,
});

function BrandEmailPage() {
  const { t } = useT();
  const { current, loading } = useTenantContext();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("brand.noBrandTitle")}</CardTitle>
          <CardDescription>{t("brand.noBrandDesc")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const tenantId = current.tenant_id;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Mail className="h-4 w-4" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("be.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("be.subtitle")}</p>
      </div>

      <Tabs defaultValue="wizard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="wizard">Майстер</TabsTrigger>
          <TabsTrigger value="campaigns">{t("be.tab.campaigns")}</TabsTrigger>
          <TabsTrigger value="automations">{t("be.tab.automations")}</TabsTrigger>
          <TabsTrigger value="settings">{t("be.tab.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="wizard">
          <EmailCampaignWizard tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="campaigns">
          <EmailCampaignsCard tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="automations">
          <EmailAutomationsCard tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="settings">
          <EmailDomainCard tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
