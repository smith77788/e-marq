/**
 * /brand/roi — Phase 18 ROI dashboard.
 * Owner-facing financial transparency for autonomous actions.
 */
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenantContext } from "@/hooks/useTenantContext";
import { ROIDashboard } from "@/components/owner/ROIDashboard";
import { CacPaybackTable } from "@/components/owner/CacPaybackTable";
import { BudgetRecommendationsTable } from "@/components/owner/BudgetRecommendationsTable";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/roi")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "ROI від AI — MARQ" },
      { name: "description", content: "Зведена панель ROI: атрибутований дохід, зекономлений час та ефективність автономних дій." },
    ],
  }),
  component: ROIPage,
});

function ROIPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/roi" });
  const { currentTenantId, setCurrentTenantId } = useTenantContext();

  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>ROI від AI</CardTitle>
          <CardDescription>
            Скільки автономний AI вже зекономив часу й приніс доходу. Дані оновлюються щодня.
          </CardDescription>
        </CardHeader>
      </Card>
      <ROIDashboard tenantId={currentTenantId} />
      <CacPaybackTable tenantId={currentTenantId} />
    </div>
  );
}
