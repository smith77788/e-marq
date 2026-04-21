import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Crown, Loader2, Save, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PlanBadge } from "@/components/admin/PlanBadge";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { OwnerPlanSwitcher } from "@/components/owner/OwnerPlanSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

const SUB_STATUS_LABEL: Record<string, string> = {
  trial: "пробний період",
  active: "активний",
  past_due: "прострочено",
  suspended: "призупинено",
  cancelled: "скасовано",
};

function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const { current, currentTenantId } = useTenantContext();
  const [fullName, setFullName] = useState((user?.user_metadata?.full_name as string | undefined) ?? "");
  const [bio, setBio] = useState((user?.user_metadata?.bio as string | undefined) ?? "");
  const [saving, setSaving] = useState(false);
  const tenantId = currentTenantId ?? current?.tenant_id;
  const canManagePlan = current?.membership_role === "owner" || current?.membership_role === "admin";

  const summaryQuery = useQuery({
    queryKey: ["plan-summary", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", { _tenant_id: tenantId! });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  async function handleSave() {
    try {
      setSaving(true);
      await updateProfile({ fullName, bio });
      toast.success("Профіль оновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не вдалось оновити профіль");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Мій профіль</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Тут можна змінити власні дані акаунта, які бачиш у робочому просторі.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            Дані акаунта
          </CardTitle>
          <CardDescription>
            Email входу: {user?.email ?? "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full-name">Імʼя</Label>
            <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ваше імʼя" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Про себе</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Короткий опис" className="min-h-28" />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Зберегти
            </Button>
          </div>
        </CardContent>
      </Card>

      {tenantId ? (
        summaryQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Завантажую тариф…</p>
        ) : summaryQuery.data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-warning" />
                  Підписка бренду {current?.tenant_name ? `· ${current.tenant_name}` : ""}
                  <PlanBadge planKey={summaryQuery.data.plan.key} planName={summaryQuery.data.plan.name} />
                </CardTitle>
                <CardDescription>
                  Статус: {SUB_STATUS_LABEL[summaryQuery.data.subscription.status] ?? summaryQuery.data.subscription.status} · Період {new Date(summaryQuery.data.subscription.current_period_start).toLocaleDateString("uk-UA")} → {new Date(summaryQuery.data.subscription.current_period_end).toLocaleDateString("uk-UA")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UsageMeters summary={summaryQuery.data} compact />
              </CardContent>
            </Card>

            {canManagePlan ? (
              <OwnerPlanSwitcher tenantId={tenantId} currentPlanKey={summaryQuery.data.plan.key} />
            ) : (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  Лише власник або адміністратор бренду може змінювати тарифний план.
                </CardContent>
              </Card>
            )}
          </>
        ) : null
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Тарифний план</CardTitle>
            <CardDescription>Підключи або обери бренд, щоб керувати його підпискою зі свого профілю.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}