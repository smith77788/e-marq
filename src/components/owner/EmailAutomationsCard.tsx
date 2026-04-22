/**
 * EmailAutomationsCard — toggle-перемикачі для 5 автоматичних email-сценаріїв.
 *
 * Стан зберігається у tenant_configs.features.email_automations.{key} = boolean.
 * Зчитуємо разом з усім config'ом, оновлюємо merge'ом, не зачіпаючи інші
 * розділи features (payments, email_settings тощо).
 *
 * Реальна логіка враховування цих прапорців в агентах email-* буде додана
 * наступним кроком — зараз картка дає власнику передбачуваний UI-контракт.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlarmClock,
  Mailbox,
  PackageCheck,
  PackageOpen,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useT, type TKey } from "@/lib/i18n";

type AutomationKey = "abandoned_cart" | "winback" | "post_purchase" | "order_status" | "restock";

type AutomationDef = {
  key: AutomationKey;
  titleKey: TKey;
  descKey: TKey;
  icon: typeof Mailbox;
  /** Default ON unless explicitly disabled. */
  defaultEnabled: boolean;
};

const AUTOMATIONS: AutomationDef[] = [
  {
    key: "abandoned_cart",
    titleKey: "be.auto.cart.title",
    descKey: "be.auto.cart.desc",
    icon: ShoppingBag,
    defaultEnabled: true,
  },
  {
    key: "winback",
    titleKey: "be.auto.winback.title",
    descKey: "be.auto.winback.desc",
    icon: Sparkles,
    defaultEnabled: true,
  },
  {
    key: "post_purchase",
    titleKey: "be.auto.post.title",
    descKey: "be.auto.post.desc",
    icon: PackageCheck,
    defaultEnabled: true,
  },
  {
    key: "order_status",
    titleKey: "be.auto.status.title",
    descKey: "be.auto.status.desc",
    icon: AlarmClock,
    defaultEnabled: true,
  },
  {
    key: "restock",
    titleKey: "be.auto.restock.title",
    descKey: "be.auto.restock.desc",
    icon: PackageOpen,
    defaultEnabled: true,
  },
];

type FeaturesShape = Record<string, unknown> & {
  email_automations?: Partial<Record<AutomationKey, boolean>>;
};

export function EmailAutomationsCard({ tenantId }: { tenantId: string }) {
  const { t } = useT();
  const qc = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["tenant-email-automations", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_configs")
        .select("features")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      const features = (data?.features ?? {}) as FeaturesShape;
      return features;
    },
  });

  const automations = useMemo<Record<AutomationKey, boolean>>(() => {
    const stored = configQuery.data?.email_automations ?? {};
    return AUTOMATIONS.reduce(
      (acc, a) => {
        acc[a.key] = stored[a.key] ?? a.defaultEnabled;
        return acc;
      },
      {} as Record<AutomationKey, boolean>,
    );
  }, [configQuery.data]);

  const toggleMutation = useMutation({
    mutationFn: async (next: { key: AutomationKey; value: boolean }) => {
      const features = (configQuery.data ?? {}) as FeaturesShape;
      const current = (features.email_automations ?? {}) as Partial<Record<AutomationKey, boolean>>;
      const updatedFeatures: FeaturesShape = {
        ...features,
        email_automations: { ...current, [next.key]: next.value },
      };
      const { error } = await supabase
        .from("tenant_configs")
        .update({ features: updatedFeatures as never })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(next.value ? t("be.auto.savedOn") : t("be.auto.savedOff"));
      qc.invalidateQueries({ queryKey: ["tenant-email-automations", tenantId] });
    },
    onError: (e: Error) => toast.error(t("be.auto.saveError"), { description: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mailbox className="h-4 w-4 text-primary" />
          {t("be.auto.title")}
        </CardTitle>
        <CardDescription className="text-xs">{t("be.auto.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {configQuery.isLoading ? (
          <div className="space-y-2">
            {AUTOMATIONS.map((a) => (
              <Skeleton key={a.key} className="h-16" />
            ))}
          </div>
        ) : (
          AUTOMATIONS.map((a) => {
            const Icon = a.icon;
            const enabled = automations[a.key];
            const pending = toggleMutation.isPending && toggleMutation.variables?.key === a.key;
            return (
              <div
                key={a.key}
                className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-card/40 p-3 sm:p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={
                      "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md " +
                      (enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
                    }
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">{t(a.titleKey)}</p>
                    <p className="text-xs text-muted-foreground">{t(a.descKey)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
                    {enabled ? t("be.auto.enabled") : t("be.auto.disabled")}
                  </span>
                  <Switch
                    checked={enabled}
                    disabled={pending}
                    onCheckedChange={(value) => toggleMutation.mutate({ key: a.key, value })}
                    aria-label={t(a.titleKey)}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
