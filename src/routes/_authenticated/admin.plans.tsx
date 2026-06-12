/**
 * Сторінка головного адміністратора: каталог тарифів.
 * Тут можна редагувати ціни, ліміти, доступні можливості.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MSG } from "@/lib/glossary";

export const Route = createFileRoute("/_authenticated/admin/plans")({
  component: AdminPlansPage,
});

type Plan = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price_cents_monthly: number;
  price_cents_yearly: number;
  currency: string;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  max_products: number | null;
  max_orders_per_month: number | null;
  max_customers: number | null;
  max_ai_runs_per_month: number | null;
  max_ai_credits_monthly_grant: number;
  max_outbound_messages_per_month: number | null;
  max_storage_mb: number | null;
  max_team_members: number | null;
  features_enabled: string[];
  agents_allowed: string[];
};

const FIELD_LABEL: Record<string, string> = {
  max_products: "Скільки товарів максимум",
  max_orders_per_month: "Замовлень на місяць",
  max_customers: "Клієнтів у базі",
  max_ai_runs_per_month: "Запусків агентів/міс (legacy, лиши порожнім = ∞)",
  max_ai_credits_monthly_grant: "Бонус кредитів балансу при переході (для add-ons)",
  max_outbound_messages_per_month: "Повідомлень клієнтам на місяць",
  max_storage_mb: "Місце для файлів (МБ)",
  max_team_members: "Учасників у команді",
};

function AdminPlansPage() {
  const { isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Plan | null>(null);

  const plansQuery = useQuery({
    queryKey: ["plans-admin"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").order("sort_order").limit(100);
      if (error) throw error;
      return data as Plan[];
    },
  });

  const savePlan = useMutation({
    mutationFn: async (plan: Plan) => {
      const { id, ...patch } = plan;
      const { error } = await supabase.from("plans").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(MSG.saved);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
      qc.invalidateQueries({ queryKey: ["plans-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errSave),
  });

  const createPlan = useMutation({
    mutationFn: async () => {
      const newKey = `plan_${Date.now()}`;
      const { error } = await supabase.from("plans").insert({
        key: newKey,
        name: "Новий тариф",
        description: "Опишіть тариф",
        sort_order: 99,
        is_public: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(MSG.created);
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errSave),
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(MSG.deleted);
      qc.invalidateQueries({ queryKey: ["plans-admin"] });
    },
    onError: (e: Error) => toast.error(e.message || MSG.errDelete),
  });

  if (loading) return <p className="text-sm text-muted-foreground">{MSG.loading}</p>;
  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Доступ заборонено</CardTitle>
        </CardHeader>
        <CardContent>
          <Link to="/dashboard" className="text-primary hover:underline">
            ← На головну
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Каталог тарифів</h1>
          <p className="text-sm text-muted-foreground">
            Ціни, ліміти, доступні можливості. Зміни побачать усі бренди.
          </p>
        </div>
        <Button onClick={() => createPlan.mutate()}>
          <Plus className="mr-1.5 h-4 w-4" />
          Новий тариф
        </Button>
      </div>

      {plansQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Завантажуємо тарифи…</p>
      ) : (
        <div className="space-y-3">
          {plansQuery.data?.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              isEditing={editing?.id === p.id}
              onEdit={() => setEditing(p)}
              onCancel={() => setEditing(null)}
              onSave={(patch) => savePlan.mutate(patch)}
              onDelete={() => {
                if (window.confirm(MSG.confirmDelete)) deletePlan.mutate(p.id);
              }}
              saving={savePlan.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  plan: Plan;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: Plan) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Plan>(plan);
  const numField = (k: keyof Plan, nullable = true) => (
    <div className="space-y-1">
      <Label className="text-xs">{FIELD_LABEL[String(k)] ?? String(k)}</Label>
      <Input
        type="number"
        value={(draft[k] as number | null) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          setDraft({ ...draft, [k]: v === "" && nullable ? null : Number(v) } as Plan);
        }}
        placeholder={nullable ? "(без обмежень)" : "0"}
      />
    </div>
  );

  if (!isEditing) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {plan.name}
              <Badge variant="outline" className="font-mono text-[10px]">
                {plan.key}
              </Badge>
              {!plan.is_active && <Badge variant="outline">вимкнено</Badge>}
              {!plan.is_public && <Badge variant="outline">прихований</Badge>}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {Math.round(plan.price_cents_monthly / 100).toLocaleString("uk-UA")} ₴/міс
              </span>
              <Button size="sm" variant="outline" onClick={onEdit}>
                Редагувати
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <CardDescription>{plan.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div>
              Товарів: <strong>{plan.max_products ?? "∞"}</strong>
            </div>
            <div>
              Замовлень/міс: <strong>{plan.max_orders_per_month ?? "∞"}</strong>
            </div>
            <div>
              Клієнтів: <strong>{plan.max_customers ?? "∞"}</strong>
            </div>
            <div>
              Агентів дозволено:{" "}
              <strong>
                {plan.agents_allowed.length === 0 ? "усі" : plan.agents_allowed.length}
              </strong>
            </div>
            <div>
              Бонус кредитів балансу:{" "}
              <strong>{plan.max_ai_credits_monthly_grant.toLocaleString("uk-UA")}</strong>
            </div>
            <div>
              Учасників команди: <strong>{plan.max_team_members ?? "∞"}</strong>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {plan.features_enabled.map((f) => (
              <Badge key={f} variant="outline" className="text-[10px]">
                {f}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Редагування: {plan.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Технічний ключ</Label>
            <Input
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Назва тарифу</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Опис</Label>
          <Textarea
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Ціна за місяць (копійки)</Label>
            <Input
              type="number"
              value={draft.price_cents_monthly}
              onChange={(e) => setDraft({ ...draft, price_cents_monthly: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label>Ціна за рік (копійки)</Label>
            <Input
              type="number"
              value={draft.price_cents_yearly}
              onChange={(e) => setDraft({ ...draft, price_cents_yearly: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label>Порядок у списку</Label>
            <Input
              type="number"
              value={draft.sort_order}
              onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border border-border p-2">
            <Label>Видно на сторінці цін</Label>
            <Switch
              checked={draft.is_public}
              onCheckedChange={(v) => setDraft({ ...draft, is_public: v })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-2">
            <Label>Тариф увімкнений</Label>
            <Switch
              checked={draft.is_active}
              onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {numField("max_products")}
          {numField("max_orders_per_month")}
          {numField("max_customers")}
          {numField("max_ai_runs_per_month")}
          {numField("max_ai_credits_monthly_grant", false)}
          {numField("max_outbound_messages_per_month")}
          {numField("max_storage_mb")}
          {numField("max_team_members")}
        </div>
        <div className="space-y-1">
          <Label>Можливості (через кому)</Label>
          <Input
            value={draft.features_enabled.join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                features_enabled: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="bot, analytics, attribution"
          />
        </div>
        <div className="space-y-1">
          <Label>Дозволені ШІ-помічники (через кому, порожнє = усі)</Label>
          <Input
            value={draft.agents_allowed.join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                agents_allowed: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
          <Button onClick={() => onSave(draft)} disabled={saving}>
            <Save className="mr-1.5 h-4 w-4" />
            Зберегти
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
