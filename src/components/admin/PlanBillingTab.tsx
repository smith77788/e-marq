/**
 * Super-admin tab for managing a tenant's plan & billing.
 * - Shows current plan, status, trial, period
 * - Change plan (calls change_tenant_plan RPC)
 * - Edit limit overrides as raw JSON
 * - Plan change history
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { PlanBadge } from "@/components/admin/PlanBadge";

const STATUS_LABELS: Record<string, string> = {
  trial: "Пробний період",
  active: "Активний",
  past_due: "Прострочено",
  suspended: "Призупинено",
  cancelled: "Скасовано",
};

export function PlanBillingTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const summaryQuery = useQuery({
    queryKey: ["plan-summary", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", { _tenant_id: tenantId });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  const plansQuery = useQuery({
    queryKey: ["plans-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("id, key, name, price_cents_monthly, is_active")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const subQuery = useQuery({
    queryKey: ["tenant-sub", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_subscriptions")
        .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, overrides, notes")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["plan-history", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_change_log")
        .select("id, from_plan_id, to_plan_id, actor_user_id, reason, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const changePlan = useMutation({
    mutationFn: async ({ planKey }: { planKey: string }) => {
      const { error } = await supabase.rpc("change_tenant_plan", {
        _tenant_id: tenantId,
        _plan_key: planKey,
        _reason: reason || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Тариф змінено");
      setReason("");
      qc.invalidateQueries({ queryKey: ["plan-summary", tenantId] });
      qc.invalidateQueries({ queryKey: ["tenant-sub", tenantId] });
      qc.invalidateQueries({ queryKey: ["plan-history", tenantId] });
      qc.invalidateQueries({ queryKey: ["my-tenants-rpc"] });
      qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateSub = useMutation({
    mutationFn: async (patch: { status?: string; trial_ends_at?: string | null; overrides?: Record<string, unknown>; notes?: string | null }) => {
      const { error } = await supabase
        .from("tenant_subscriptions")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(patch as any)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["plan-summary", tenantId] });
      qc.invalidateQueries({ queryKey: ["tenant-sub", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (summaryQuery.isLoading || subQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Завантажую…</p>;
  }
  const summary = summaryQuery.data;
  const sub = subQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Поточний тариф
            {summary && <PlanBadge planKey={summary.plan.key} planName={summary.plan.name} />}
            {sub && <Badge variant="outline">{STATUS_LABELS[sub.status] ?? sub.status}</Badge>}
          </CardTitle>
          <CardDescription>
            Період: {sub ? new Date(sub.current_period_start).toLocaleDateString("uk-UA") : "—"} → {sub ? new Date(sub.current_period_end).toLocaleDateString("uk-UA") : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary && <UsageMeters summary={summary} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Змінити тариф</CardTitle>
          <CardDescription>При переході нараховуються нові щомісячні AI-кредити, статус — «активний».</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="reason">Причина (необов'язково)</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Чому змінюємо тариф?" />
          </div>
          <div className="flex flex-wrap gap-2">
            {plansQuery.data?.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={summary?.plan.key === p.key ? "default" : "outline"}
                onClick={() => changePlan.mutate({ planKey: p.key })}
                disabled={changePlan.isPending}
              >
                {p.name}
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {p.price_cents_monthly === 0 ? "безкоштовно" : `${Math.round(p.price_cents_monthly / 100).toLocaleString("uk-UA")} ₴/міс`}
                </span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {sub && (
        <Card>
          <CardHeader>
            <CardTitle>Налаштування підписки</CardTitle>
            <CardDescription>Статус, пробний період, особисті ліміти.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Статус</Label>
                <Select
                  value={sub.status}
                  onValueChange={(v) => updateSub.mutate({ status: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Пробний період</SelectItem>
                    <SelectItem value="active">Активний</SelectItem>
                    <SelectItem value="past_due">Прострочено</SelectItem>
                    <SelectItem value="suspended">Призупинено</SelectItem>
                    <SelectItem value="cancelled">Скасовано</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Пробний період закінчується</Label>
                <Input
                  type="date"
                  defaultValue={sub.trial_ends_at ? new Date(sub.trial_ends_at).toISOString().slice(0, 10) : ""}
                  onBlur={(e) => updateSub.mutate({ trial_ends_at: e.target.value || null })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Особисті ліміти (JSON)</Label>
              <p className="text-xs text-muted-foreground">
                Ключі: max_products (товари), max_orders_per_month (замовлення/міс),
                max_customers (клієнти), max_ai_runs_per_month (запуски AI/міс),
                max_outbound_messages_per_month (повідомлення/міс), max_storage_mb (сховище),
                max_team_members (учасники команди). Вкажи null — щоб без ліміту.
              </p>
              <Textarea
                rows={6}
                defaultValue={JSON.stringify(sub.overrides ?? {}, null, 2)}
                className="font-mono text-xs"
                onBlur={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value || "{}");
                    updateSub.mutate({ overrides: parsed });
                  } catch {
                    toast.error("Невірний JSON");
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Внутрішні нотатки</Label>
              <Textarea
                rows={2}
                defaultValue={sub.notes ?? ""}
                onBlur={(e) => updateSub.mutate({ notes: e.target.value || null })}
                placeholder="Видно тільки супер-адмінам."
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Історія зміни тарифів</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.data && historyQuery.data.length > 0 ? (
            <ul className="space-y-2 text-xs">
              {historyQuery.data.map((h) => (
                <li key={h.id} className="rounded border border-border bg-muted/20 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-muted-foreground">{new Date(h.created_at).toLocaleString("uk-UA")}</span>
                  </div>
                  <div className="mt-1 text-foreground">
                    {h.reason || <span className="italic text-muted-foreground">Без причини</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Поки що змін не було.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
