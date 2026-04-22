/**
 * Owner billing view: current plan + plan switcher.
 * Credits/money balance UI removed — subscription is unlimited within plan limits.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Crown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { PlanBadge } from "@/components/admin/PlanBadge";
import { OwnerPlanSwitcher } from "@/components/owner/OwnerPlanSwitcher";
import { BalanceCard } from "@/components/owner/BalanceCard";

type Search = { tenant?: string };

const SUB_STATUS_LABEL: Record<string, string> = {
  trial: "пробний період",
  active: "активний",
  past_due: "прострочено",
  suspended: "призупинено",
  cancelled: "скасовано",
};

export const Route = createFileRoute("/_authenticated/brand/billing")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandBillingPage,
});

function BrandBillingPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/billing" });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();

  // Sync URL → context
  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId = urlTenant ?? currentTenantId ?? current?.tenant_id;

  const summaryQuery = useQuery({
    queryKey: ["plan-summary", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", {
        _tenant_id: tenantId!,
      });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  // Якщо tenant context ще завантажується, показуємо skeleton — НЕ редіректимо
  if (loading || (!tenantId && tenants.length === 0 && !loading === false)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Завантаження…</CardTitle>
          <CardDescription>Підбираємо ваш бренд</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Реально немає брендів у користувача
  if (!tenantId && tenants.length === 0) {
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

  // Tenant є у списку, але currentTenantId ще не встановлено — беремо перший
  const effectiveTenantId = tenantId ?? tenants[0]?.tenant_id;
  if (!effectiveTenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Бренд не обрано</CardTitle>
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

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/brand"
          search={{ tenant: tenantId }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Назад до {current?.tenant_name ?? "брендa"}
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

      <BalanceCard tenantId={tenantId} tenantSlug={current?.tenant_slug ?? "brand"} />

      {summary && <OwnerPlanSwitcher tenantId={tenantId} currentPlanKey={summary.plan.key} />}
    </div>
  );
}
