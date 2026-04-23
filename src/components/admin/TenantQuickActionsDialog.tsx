/**
 * Compact quick-actions dialog for a single tenant on /admin/tenants.
 * Lets a super-admin: pause/resume/disable, change plan, and impersonate
 * (open the brand cockpit as that tenant) — all in one modal.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pause, Play, PowerOff, Sparkles, LogIn, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type QuickActionsTenant = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  status: string;
  plan_key: string;
  plan_name: string;
};

const STATUS_LABEL: Record<string, string> = {
  active: "активний",
  suspended: "призупинено",
  inactive: "вимкнено",
};

export function TenantQuickActionsDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: QuickActionsTenant | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setCurrentTenantId } = useTenantContext();
  const [planKey, setPlanKey] = useState<string>("");

  const plansQuery = useQuery({
    queryKey: ["plans-catalog-quick"],
    enabled: open,
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
    void qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
  };

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      if (!tenant) throw new Error("No tenant");
      const { error } = await supabase.rpc("admin_set_tenant_status", {
        _tenant_id: tenant.tenant_id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: (_d, status) => {
      toast.success(`Статус → ${STATUS_LABEL[status] ?? status}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePlan = useMutation({
    mutationFn: async (key: string) => {
      if (!tenant) throw new Error("No tenant");
      const { error } = await supabase.rpc("change_tenant_plan", {
        _tenant_id: tenant.tenant_id,
        _plan_key: key,
        _reason: "Admin quick action",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Тариф оновлено");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!tenant) return null;

  const isActive = tenant.status === "active";
  const isSuspended = tenant.status === "suspended";
  const busy = setStatus.isPending || changePlan.isPending;

  const enterAsOwner = () => {
    setCurrentTenantId(tenant.tenant_id);
    onOpenChange(false);
    void navigate({ to: "/brand", search: { tenant: tenant.tenant_id } as never });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tenant.tenant_name}
            <Badge variant="outline" className="text-[10px]">
              /{tenant.tenant_slug}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Швидкі дії: статус · тариф · вхід як власник
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Статус: <strong>{STATUS_LABEL[tenant.status] ?? tenant.status}</strong>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant={isSuspended ? "default" : "outline"}
                disabled={busy || isSuspended}
                onClick={() => setStatus.mutate("suspended")}
              >
                <Pause className="mr-1 h-3 w-3" /> Пауза
              </Button>
              <Button
                size="sm"
                variant={isActive ? "default" : "outline"}
                disabled={busy || isActive}
                onClick={() => setStatus.mutate("active")}
              >
                <Play className="mr-1 h-3 w-3" /> Відновити
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || tenant.status === "inactive"}
                onClick={() => setStatus.mutate("inactive")}
              >
                <PowerOff className="mr-1 h-3 w-3" /> Вимкнути
              </Button>
            </div>
          </div>

          {/* Plan */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              <Sparkles className="mr-1 inline h-3 w-3" />
              Тариф: <strong>{tenant.plan_name}</strong>
            </Label>
            <div className="flex gap-2">
              <Select
                value={planKey || tenant.plan_key}
                onValueChange={setPlanKey}
                disabled={busy || plansQuery.isLoading}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Оберіть тариф" />
                </SelectTrigger>
                <SelectContent>
                  {(plansQuery.data ?? []).map((p) => (
                    <SelectItem key={p.key} value={p.key} className="text-xs">
                      {p.name}{" "}
                      <span className="ml-1 text-muted-foreground">
                        ({p.price_cents_monthly === 0
                          ? "free"
                          : `${p.price_cents_monthly / 100}₴`})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={busy || !planKey || planKey === tenant.plan_key}
                onClick={() => changePlan.mutate(planKey)}
              >
                {changePlan.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Застосувати"
                )}
              </Button>
            </div>
          </div>

          {/* Enter as owner */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Доступ
            </Label>
            <Button
              variant="secondary"
              className="w-full"
              onClick={enterAsOwner}
              disabled={busy}
            >
              <LogIn className="mr-2 h-4 w-4" />
              Увійти як власник цього бренду
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Перемкне активний бренд у контексті та відкриє командний центр.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Закрити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
