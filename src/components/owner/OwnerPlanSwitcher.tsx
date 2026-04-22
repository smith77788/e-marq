/**
 * Self-service plan switcher for tenant owners/admins.
 * Calls owner_change_plan RPC (server-side enforces is_tenant_admin).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { PlanBadge } from "@/components/admin/PlanBadge";

type Plan = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price_cents_monthly: number;
  currency: string;
  max_ai_credits_monthly_grant: number;
  max_products: number | null;
  max_orders_per_month: number | null;
  features_enabled: string[];
};

export function OwnerPlanSwitcher({
  tenantId,
  currentPlanKey,
}: {
  tenantId: string;
  currentPlanKey: string;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const plansQuery = useQuery({
    queryKey: ["plans-public-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select(
          "id, key, name, description, price_cents_monthly, currency, max_ai_credits_monthly_grant, max_products, max_orders_per_month, features_enabled",
        )
        .eq("is_active", true)
        .eq("is_public", true)
        .order("sort_order");
      if (error) throw error;
      return data as Plan[];
    },
  });

  const change = useMutation({
    mutationFn: async (planKey: string) => {
      const { error } = await supabase.rpc("owner_change_plan", {
        _tenant_id: tenantId,
        _plan_key: planKey,
        _reason: reason || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Тариф оновлено");
      setReason("");
      qc.invalidateQueries({ queryKey: ["plan-summary", tenantId] });
      qc.invalidateQueries({ queryKey: ["balance-ledger", tenantId] });
      qc.invalidateQueries({ queryKey: ["my-tenants-rpc"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (plansQuery.isLoading)
    return <p className="text-xs text-muted-foreground">Завантажую тарифи…</p>;
  const plans = plansQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Crown className="h-4 w-4 text-warning" />
          Обрати тариф
        </CardTitle>
        <CardDescription>
          Перемикайся між публічними тарифами в один клік. Нові щомісячні AI-кредити нараховуються
          одразу.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="plan-reason">Причина зміни (необов'язково)</Label>
          <Input
            id="plan-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Наприклад: треба більше AI-кредитів"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const isCurrent = p.key === currentPlanKey;
            const priceLabel =
              p.price_cents_monthly === 0
                ? "безкоштовно"
                : `${Math.round(p.price_cents_monthly / 100).toLocaleString("uk-UA")} ${p.currency}/міс`;
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-4 ${
                  isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <PlanBadge planKey={p.key} planName={p.name} />
                  {isCurrent && <Badge variant="default">Поточний</Badge>}
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums">{priceLabel}</p>
                {p.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                )}
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <li>
                    ✦ {p.max_ai_credits_monthly_grant.toLocaleString("uk-UA")} AI-кредитів/міс
                  </li>
                  <li>✦ {p.max_products ?? "Без ліміту"} товарів</li>
                  <li>✦ {p.max_orders_per_month ?? "Без ліміту"} замовлень/міс</li>
                </ul>
                <Button
                  size="sm"
                  className="mt-4 w-full"
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isCurrent || change.isPending}
                  onClick={() => change.mutate(p.key)}
                >
                  {isCurrent
                    ? "Уже активний"
                    : change.isPending
                      ? "Оновлюю…"
                      : "Перейти на цей тариф"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
