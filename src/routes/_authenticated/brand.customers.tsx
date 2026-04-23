/**
 * /brand/customers — окрема сторінка для роботи з клієнтами:
 * топ-клієнти, повний реєстр, сегменти, lifecycle-розподіл.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantContext } from "@/hooks/useTenantContext";
import { TopCustomers } from "@/components/owner/TopCustomers";
import { CustomerRoster } from "@/components/owner/CustomerRoster";
import { LifecycleDistribution } from "@/components/owner/LifecycleDistribution";
import { CohortRetention } from "@/components/owner/CohortRetention";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/customers")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Клієнти — MARQ" },
      { name: "description", content: "Топ-клієнти, реєстр, сегменти та lifecycle-аналітика" },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/customers" });
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
        <h1 className="text-2xl font-bold tracking-tight">Клієнти</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Огляд клієнтської бази: хто приносить найбільше доходу, як виглядає життєвий цикл і
          утримання по когортах.
        </p>
      </div>

      <TopCustomers tenantId={tenantId} />
      <div className="grid gap-6 lg:grid-cols-2">
        <LifecycleDistribution tenantId={tenantId} />
        <CohortRetention tenantId={tenantId} />
      </div>
      <CustomerRoster tenantId={tenantId} />
    </div>
  );
}
