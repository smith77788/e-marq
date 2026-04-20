/**
 * SetupChecklist — карточка вгорі /brand з 7 пунктами налаштування.
 * Перевіряє реальний стан по тенанту (продукти, клієнти, токен, події).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useT, type TKey } from "@/lib/i18n";

type Props = { tenantId: string; tenantSlug: string };

type Status = {
  brand: boolean;
  channel: boolean;
  product: boolean;
  customers: boolean;
  tracking: boolean;
  payment: boolean;
  team: boolean;
};

export function SetupChecklist({ tenantId, tenantSlug }: Props) {
  const { t } = useT();

  const { data: status } = useQuery({
    queryKey: ["setup-checklist", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<Status> => {
      const [tenantRes, configRes, productsRes, customersRes, eventsRes, membersRes, routingRes] =
        await Promise.all([
          supabase.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
          supabase.from("tenant_configs").select("bot, features").eq("tenant_id", tenantId).maybeSingle(),
          supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).limit(1),
          supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).limit(1),
          supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .limit(1),
          supabase.from("tenant_memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).limit(1),
          supabase
            .from("telegram_chat_routing")
            .select("chat_id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .limit(1),
        ]);
      const features = (configRes.data?.features ?? {}) as Record<string, unknown>;
      return {
        brand: !!tenantRes.data,
        // Channel = at least one Telegram chat bound to this tenant via shared bot
        channel: (routingRes.count ?? 0) > 0,
        product: (productsRes.count ?? 0) > 0,
        customers: (customersRes.count ?? 0) > 0,
        tracking: (eventsRes.count ?? 0) > 0,
        payment: typeof features.payment_method === "string",
        team: (membersRes.count ?? 0) > 1,
      };
    },
  });

  const items: Array<{ key: keyof Status; labelKey: TKey }> = [
    { key: "brand", labelKey: "checklist.s1" },
    { key: "channel", labelKey: "checklist.s2" },
    { key: "product", labelKey: "checklist.s3" },
    { key: "customers", labelKey: "checklist.s4" },
    { key: "tracking", labelKey: "checklist.s5" },
    { key: "payment", labelKey: "checklist.s6" },
    { key: "team", labelKey: "checklist.s7" },
  ];

  const done = items.filter((i) => status?.[i.key]).length;
  const pct = Math.round((done / items.length) * 100);
  const allDone = done === items.length;

  if (allDone) {
    return (
      <Card className="border-success/30 bg-success/5">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <p className="text-sm font-medium">{t("checklist.allDone")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("checklist.title")}
            </CardTitle>
            <CardDescription className="mt-1">{t("checklist.desc")}</CardDescription>
          </div>
          <Button asChild size="sm">
            <Link to="/onboarding" search={{ tenant: tenantId, slug: tenantSlug }}>
              {t("checklist.continue")}
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Progress value={pct} className="h-2 flex-1" />
          <span className="text-xs font-medium text-muted-foreground">
            {done}/{items.length}
          </span>
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map((it) => {
            const ok = !!status?.[it.key];
            return (
              <li key={it.key} className="flex items-center gap-2 text-sm">
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                )}
                <span className={ok ? "text-foreground" : "text-muted-foreground"}>{t(it.labelKey)}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
