/**
 * Inline tenant manager for a specific user shown inside the admin/users page.
 * Lets a super-admin: switch plan, top-up / deduct AI credits and money balance,
 * and jump to the full tenant detail page.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Coins, Wallet, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";

type TenantRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  role: string | null;
  plan_key: string;
  plan_name: string;
  subscription_status: string;
  ai_credits_balance: number;
  money_balance_cents: number;
  current_period_end: string | null;
};

export function UserTenantsManager({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { has } = useAdminCapabilities();
  const canChangePlan = has("change_plans");
  const canManageUsers = has("manage_users");

  const tenantsQuery = useQuery({
    queryKey: ["admin-user-tenants", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_user_tenants", {
        _target_user_id: userId,
      });
      if (error) throw error;
      return (data ?? []) as TenantRow[];
    },
  });

  const plansQuery = useQuery({
    queryKey: ["plans-catalog-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("key, name, price_cents_monthly")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-user-tenants", userId] });
    void qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
  };

  const changePlan = useMutation({
    mutationFn: async ({ tenantId, planKey }: { tenantId: string; planKey: string }) => {
      const { error } = await supabase.rpc("change_tenant_plan", {
        _tenant_id: tenantId,
        _plan_key: planKey,
        _reason: "Admin change via Users page",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Тариф оновлено");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustCredits = useMutation({
    mutationFn: async ({ tenantId, delta }: { tenantId: string; delta: number }) => {
      const { error } = await supabase.rpc("admin_adjust_ai_credits", {
        _tenant_id: tenantId,
        _delta: delta,
        _reason: "Admin adjust via Users page",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("AI-кредити оновлено");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustMoney = useMutation({
    mutationFn: async ({ tenantId, deltaCents }: { tenantId: string; deltaCents: number }) => {
      const { error } = await supabase.rpc("admin_adjust_money_balance", {
        _tenant_id: tenantId,
        _delta_cents: deltaCents,
        _reason: "Admin adjust via Users page",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Грошовий баланс оновлено");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (tenantsQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Завантажую бренди користувача…</p>;
  }
  const tenants = tenantsQuery.data ?? [];
  if (tenants.length === 0) {
    return <p className="text-xs text-muted-foreground">У цього користувача немає брендів.</p>;
  }

  return (
    <div className="space-y-3">
      {tenants.map((t) => (
        <TenantBlock
          key={t.tenant_id}
          tenant={t}
          plans={plansQuery.data ?? []}
          onChangePlan={(planKey) => changePlan.mutate({ tenantId: t.tenant_id, planKey })}
          onAdjustCredits={(delta) => adjustCredits.mutate({ tenantId: t.tenant_id, delta })}
          onAdjustMoney={(deltaCents) => adjustMoney.mutate({ tenantId: t.tenant_id, deltaCents })}
          busy={changePlan.isPending || adjustCredits.isPending || adjustMoney.isPending}
          canChangePlan={canChangePlan}
          canManageUsers={canManageUsers}
        />
      ))}
    </div>
  );
}

function TenantBlock({
  tenant,
  plans,
  onChangePlan,
  onAdjustCredits,
  onAdjustMoney,
  busy,
  canChangePlan,
  canManageUsers,
}: {
  tenant: TenantRow;
  plans: { key: string; name: string; price_cents_monthly: number }[];
  onChangePlan: (planKey: string) => void;
  onAdjustCredits: (delta: number) => void;
  onAdjustMoney: (deltaCents: number) => void;
  busy: boolean;
  canChangePlan: boolean;
  canManageUsers: boolean;
}) {
  const [creditsDelta, setCreditsDelta] = useState("100");
  const [moneyDelta, setMoneyDelta] = useState("100");

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{tenant.tenant_name}</span>
            <Badge variant="outline" className="text-[10px]">
              /{tenant.tenant_slug}
            </Badge>
            {tenant.role && (
              <Badge variant="secondary" className="text-[10px]">
                {tenant.role}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Тариф: <strong>{tenant.plan_name}</strong> · Підписка: {tenant.subscription_status} ·
            Статус: {tenant.tenant_status}
          </div>
        </div>
        <Link
          to="/admin/tenants/$tenantId"
          params={{ tenantId: tenant.tenant_id }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Деталі бренду <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {/* Plan */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <Sparkles className="mr-1 inline h-3 w-3" /> Тариф
          </Label>
          <Select
            value={tenant.plan_key}
            onValueChange={(v) => v !== tenant.plan_key && onChangePlan(v)}
            disabled={busy || !canChangePlan}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plans.map((p) => (
                <SelectItem key={p.key} value={p.key} className="text-xs">
                  {p.name}{" "}
                  <span className="ml-1 text-muted-foreground">
                    ({p.price_cents_monthly === 0 ? "free" : `${p.price_cents_monthly / 100}₴`})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* AI credits */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <Coins className="mr-1 inline h-3 w-3" /> AI-кредити: {tenant.ai_credits_balance}
          </Label>
          <div className="flex gap-1">
            <Input
              value={creditsDelta}
              onChange={(e) => setCreditsDelta(e.target.value)}
              type="number"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canManageUsers}
              onClick={() => onAdjustCredits(parseInt(creditsDelta || "0", 10))}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canManageUsers}
              onClick={() => onAdjustCredits(-parseInt(creditsDelta || "0", 10))}
            >
              −
            </Button>
          </div>
        </div>

        {/* Money */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <Wallet className="mr-1 inline h-3 w-3" /> Баланс:{" "}
            {(tenant.money_balance_cents / 100).toLocaleString("uk-UA")} ₴
          </Label>
          <div className="flex gap-1">
            <Input
              value={moneyDelta}
              onChange={(e) => setMoneyDelta(e.target.value)}
              type="number"
              className="h-8 text-xs"
              placeholder="₴"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canManageUsers}
              onClick={() => onAdjustMoney(Math.round(parseFloat(moneyDelta || "0") * 100))}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canManageUsers}
              onClick={() => onAdjustMoney(-Math.round(parseFloat(moneyDelta || "0") * 100))}
            >
              −
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
