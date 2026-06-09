/**
 * /brand/acos-loop — Owner Dashboard для closed-loop ACOS:
 * insights → decisions → outcomes + approval queue + agent ROI.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantContext } from "@/hooks/useTenantContext";
import { AcosLoopDashboard } from "@/components/owner/AcosLoopDashboard";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/acos-loop")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "ACOS Loop — MARQ" },
      {
        name: "description",
        content:
          "Closed-loop дашборд: insights, черга рішень, ROI агентів та outcomes",
      },
    ],
  }),
  component: AcosLoopPage,
});

function AcosLoopPage() {
  const { tenant: urlTenant } = useSearch({
    from: "/_authenticated/brand/acos-loop",
  });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } =
    useTenantContext();

  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
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
        <h1 className="text-2xl font-bold tracking-tight">ACOS Loop</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Кругообіг автономних рішень: інсайти → пропозиції → схвалення → виконання
          → виміряний результат → пам'ять. Тут ви бачите весь цикл і керуєте чергою
          схвалень одним кліком.
        </p>
      </div>

      <AcosLoopDashboard tenantId={tenantId} />
    </div>
  );
}
