/**
 * Owner billing view: current plan + plan switcher.
 * Credits/money balance UI removed — subscription is unlimited within plan limits.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Crown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { PlanBadge } from "@/components/admin/PlanBadge";
import { OwnerPlanSwitcher } from "@/components/owner/OwnerPlanSwitcher";
import { BalanceCard } from "@/components/owner/BalanceCard";
import { trackBilling } from "@/lib/billingTelemetry";

type Search = { tenant?: string };

const SUB_STATUS_LABEL: Record<string, string> = {
  trial: "пробний період",
  active: "активний",
  past_due: "прострочено",
  suspended: "призупинено",
  cancelled: "скасовано",
};

export const Route = createFileRoute("/_authenticated/brand_/billing")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandBillingPage,
});

function BrandBillingPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand_/billing" });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();

  // Sync URL → context
  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  // Резолвимо ефективний tenantId: URL → context → перший tenant зі списку
  const effectiveTenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;

  const summaryQuery = useQuery({
    queryKey: ["plan-summary", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", {
        _tenant_id: effectiveTenantId!,
      });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  // Телеметрія: page_view один раз на mount, bounce якщо вийшли <2с
  const mountedAtRef = useRef<number>(0);
  const viewLoggedRef = useRef(false);
  useEffect(() => {
    if (!effectiveTenantId || viewLoggedRef.current) return;
    viewLoggedRef.current = true;
    mountedAtRef.current = Date.now();
    trackBilling(effectiveTenantId, "billing.page_view");
    return () => {
      const dwell = Date.now() - mountedAtRef.current;
      if (dwell < 2000) {
        trackBilling(effectiveTenantId, "billing.page_bounce", { dwell_ms: dwell });
      }
    };
  }, [effectiveTenantId]);

  // Якщо запит даних плану звалився — фіксуємо як nav_failed (інколи це таймаут RPC)
  useEffect(() => {
    if (effectiveTenantId && summaryQuery.isError) {
      trackBilling(effectiveTenantId, "billing.nav_failed", {
        error: summaryQuery.error instanceof Error ? summaryQuery.error.message : "unknown",
        stage: "plan_summary",
      });
    }
  }, [effectiveTenantId, summaryQuery.isError, summaryQuery.error]);

  // Поки tenant context завантажується — показуємо shimmer skeleton, НЕ редіректимо
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Реально немає брендів
  if (!effectiveTenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Бренд не обрано</CardTitle>
          <CardDescription>У вас ще немає підключених брендів.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/brand" className="text-primary hover:underline">
            ← Назад на головну
          </Link>
        </CardContent>
      </Card>
    );
  }

  const summary = summaryQuery.data;
  const activeTenant = tenants.find((t) => t.tenant_id === effectiveTenantId) ?? current;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/brand"
          search={{ tenant: effectiveTenantId }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Назад до {activeTenant?.tenant_name ?? "бренда"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Тарифний план</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обери тариф — і користуйся всім без обмежень за хвилинами чи кредитами. Ліміти стосуються
          лише обсягу (товари, замовлення, клієнти).
        </p>
      </div>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-warning" />
              Поточний тариф
              <PlanBadge planKey={summary.plan.key} planName={summary.plan.name} />
            </CardTitle>
            <CardDescription>
              Статус: {SUB_STATUS_LABEL[summary.subscription.status] ?? summary.subscription.status}{" "}
              · Період{" "}
              {new Date(summary.subscription.current_period_start).toLocaleDateString("uk-UA")} →{" "}
              {new Date(summary.subscription.current_period_end).toLocaleDateString("uk-UA")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsageMeters summary={summary} />
          </CardContent>
        </Card>
      )}

      <BalanceCard tenantId={effectiveTenantId} tenantSlug={activeTenant?.tenant_slug ?? "brand"} />

      {summary && (
        <OwnerPlanSwitcher tenantId={effectiveTenantId} currentPlanKey={summary.plan.key} />
      )}
    </div>
  );
}
