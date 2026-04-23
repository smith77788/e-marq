/**
 * /brand/channels — окрема сторінка для налаштування каналів продажів
 * (вітрина, Telegram, лендінг, соцмережі тощо).
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantContext } from "@/hooks/useTenantContext";
import { ChannelSetup } from "@/components/owner/ChannelSetup";
import { IntegrationGuide } from "@/components/owner/IntegrationGuide";
import { OwnerTelegramBindCard } from "@/components/owner/OwnerTelegramBindCard";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/channels")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Канали — MARQ" },
      { name: "description", content: "Вітрина, Telegram, лендінги — усі канали продажів" },
    ],
  }),
  component: ChannelsPage,
});

function ChannelsPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/channels" });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();

  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;
  const tenant = tenants.find((t) => t.tenant_id === tenantId) ?? current;
  const tenantSlug = tenant?.tenant_slug ?? "brand";

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Бренд не обрано</CardTitle>
          <CardDescription>Спочатку створіть або оберіть бренд.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/brand">← Назад</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Канали продажів</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Підключіть та налаштуйте канали, через які покупці знаходять і купують ваші товари.
        </p>
      </div>

      <ChannelSetup tenantId={tenantId} tenantSlug={tenantSlug} />
      <OwnerTelegramBindCard tenantId={tenantId} tenantSlug={tenantSlug} />
      <IntegrationGuide tenantSlug={tenantSlug} />
    </div>
  );
}
