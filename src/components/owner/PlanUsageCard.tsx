/**
 * Owner-facing plan & usage summary.
 * Read-only — owners cannot self-upgrade (super-admin controlled in this iteration).
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Crown, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { PlanBadge } from "@/components/admin/PlanBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantContext } from "@/hooks/useTenantContext";
import { trackBilling } from "@/lib/billingTelemetry";

export function PlanUsageCard({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["plan-summary", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-7 w-32" />
          </div>
          <Skeleton className="mt-2 h-3 w-2/3" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  // Anti-cheat banner: any metric >= 90%?
  const overLimit = Object.entries(data.limits).some(([k, limit]) => {
    if (limit === null || limit === undefined) return false;
    const metricKey = k
      .replace(/^max_/, "")
      .replace(/_per_month$/, "_count")
      .replace(/^/, "");
    const usageKey =
      k === "max_products"
        ? "products_count"
        : k === "max_orders_per_month"
          ? "orders_count"
          : k === "max_customers"
            ? "customers_count"
            : k === "max_ai_runs_per_month"
              ? "ai_runs_count"
              : k === "max_outbound_messages_per_month"
                ? "outbound_messages_count"
                : metricKey;
    return Number(data.usage[usageKey] ?? 0) >= Number(limit);
  });

  return (
    <Card className={overLimit ? "border-destructive/50" : ""}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crown className="h-4 w-4 text-warning" />
            Ваш тариф
            <PlanBadge planKey={data.plan.key} planName={data.plan.name} />
            <Badge variant="outline">
              {data.subscription.status === "active"
                ? "активна"
                : data.subscription.status === "trial"
                  ? "пробний період"
                  : data.subscription.status === "past_due"
                    ? "не оплачено"
                    : data.subscription.status === "canceled"
                      ? "скасовано"
                      : data.subscription.status}
            </Badge>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => void navigate({ to: "/brand/billing", search: { tenant: tenantId } })}
          >
            Оплата та баланс <ExternalLink className="ml-1 h-3 w-3" />
          </Button>
        </div>
        <CardDescription>
          Безлімітне користування агентами в межах тарифу · Період до{" "}
          {new Date(data.subscription.current_period_end).toLocaleDateString("uk-UA")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UsageMeters summary={data} compact />
        {overLimit && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            ⚠ Ви досягли ліміту тарифу. Нові записи цього типу будуть заблоковані. Звʼяжіться з
            підтримкою, щоб підвищити тариф.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
