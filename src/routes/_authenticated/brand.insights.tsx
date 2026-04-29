/**
 * /brand/insights — окрема сторінка для AI-інсайтів і черги дій.
 * Раніше це був hash-якір на /brand, але користувачі плуталися.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantContext } from "@/hooks/useTenantContext";
import { InsightsPanel } from "@/components/owner/InsightsPanel";
import { AgentTimeline } from "@/components/owner/AgentTimeline";
import { MemoryInspector } from "@/components/owner/MemoryInspector";
import { ACOSStats } from "@/components/owner/ACOSStats";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/insights")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Insights — MARQ" },
      { name: "description", content: "AI-інсайти, рекомендації та черга дій агентів" },
    ],
  }),
  component: InsightsPage,
});

function InsightsPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/insights" });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();

  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;

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
        <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-агенти аналізують ваш бізнес 24/7. Тут — пріоритезовані інсайти та рекомендовані дії,
          які ви можете схвалити або відхилити.
        </p>
      </div>

      <ACOSStats tenantId={tenantId} />
      <InsightsPanel tenantId={tenantId} />
      <AgentTimeline tenantId={tenantId} />
      <MemoryInspector tenantId={tenantId} />
    </div>
  );
}
