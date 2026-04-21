import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { Activity, Brain, CheckCircle2, MessageCircle, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type TimelineItem = {
  id: string;
  ts: number;
  kind: "insight" | "action" | "outbound" | "run";
  title: string;
  detail: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
};

const ICON_BY_KIND: Record<TimelineItem["kind"], typeof Activity> = {
  insight: Brain,
  action: CheckCircle2,
  outbound: MessageCircle,
  run: Sparkles,
};

const ICON_BY_TYPE: Record<string, typeof Activity> = {
  price_revert: RotateCcw,
  churn_risk: AlertTriangle,
  stockout_predicted: AlertTriangle,
};

export function AgentTimeline({ tenantId }: Props) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["agent-timeline", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TimelineItem[]> => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const [insightsRes, actionsRes, outboundRes, runsRes] = await Promise.all([
        supabase
          .from("ai_insights")
          .select("id, created_at, title, insight_type, risk_level, status")
          .eq("tenant_id", tenantId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("ai_actions")
          .select("id, applied_at, action_type, agent_id, expected_impact, actual_result")
          .eq("tenant_id", tenantId)
          .eq("status", "applied")
          .gte("applied_at", since)
          .order("applied_at", { ascending: false })
          .limit(30),
        supabase
          .from("outbound_messages")
          .select("id, sent_at, created_at, channel, trigger_kind, status, body")
          .eq("tenant_id", tenantId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("acos_agent_runs")
          .select("id, started_at, agent_id, status, insights_created")
          .eq("tenant_id", tenantId)
          .gte("started_at", since)
          .gt("insights_created", 0)
          .order("started_at", { ascending: false })
          .limit(20),
      ]);

      const out: TimelineItem[] = [];

      const RISK_LABEL: Record<string, string> = { high: "високий", medium: "середній", low: "низький" };
      const STATUS_LABEL: Record<string, string> = { new: "нова", applied: "застосовано", dismissed: "відхилена", sent: "надіслано", failed: "помилка", queued: "у черзі", success: "успіх", running: "виконується", error: "помилка" };
      const TRIGGER_LABEL: Record<string, string> = { reorder: "повторне замовлення", winback: "повернення клієнта", abandoned_cart: "покинутий кошик", promo: "промо", sales_reply: "відповідь продавця" };
      const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram", email: "email", sms: "SMS" };

      for (const r of insightsRes.data ?? []) {
        out.push({
          id: `i-${r.id}`,
          ts: new Date(r.created_at).getTime(),
          kind: "insight",
          title: r.title,
          detail: `${r.insight_type.replace(/_/g, " ")} · ${STATUS_LABEL[r.status] ?? r.status}`,
          badge: RISK_LABEL[r.risk_level] ?? r.risk_level,
          badgeVariant: r.risk_level === "high" ? "destructive" : r.risk_level === "medium" ? "default" : "secondary",
        });
      }

      for (const r of actionsRes.data ?? []) {
        if (!r.applied_at) continue;
        const result = (r.actual_result ?? {}) as Record<string, unknown>;
        let detail = r.expected_impact ?? r.action_type.replace(/_/g, " ");
        if (typeof result.queued_messages === "number") {
          detail = `Поставлено в чергу ${result.queued_messages} нагадувань для VIP`;
        } else if (typeof result.old_price_cents === "number" && typeof result.new_price_cents === "number") {
          detail = `Ціна ${(result.old_price_cents / 100).toFixed(2)} ₴ → ${(result.new_price_cents / 100).toFixed(2)} ₴`;
        }
        out.push({
          id: `a-${r.id}`,
          ts: new Date(r.applied_at).getTime(),
          kind: "action",
          title: `Виконано: ${r.action_type.replace(/_/g, " ")}`,
          detail,
          badge: r.agent_id,
          badgeVariant: "outline",
        });
      }

      for (const r of outboundRes.data ?? []) {
        const ts = r.sent_at ?? r.created_at;
        out.push({
          id: `o-${r.id}`,
          ts: new Date(ts).getTime(),
          kind: "outbound",
          title: `${TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind.replace(/_/g, " ")} → ${CHANNEL_LABEL[r.channel] ?? r.channel}`,
          detail: r.body.slice(0, 110) + (r.body.length > 110 ? "…" : ""),
          badge: STATUS_LABEL[r.status] ?? r.status,
          badgeVariant: r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "secondary",
        });
      }

      for (const r of runsRes.data ?? []) {
        out.push({
          id: `r-${r.id}`,
          ts: new Date(r.started_at).getTime(),
          kind: "run",
          title: `${r.agent_id} створив ${r.insights_created} ${r.insights_created === 1 ? "підказку" : "підказок"}`,
          detail: `запуск агента · ${STATUS_LABEL[r.status] ?? r.status}`,
          badge: STATUS_LABEL[r.status] ?? r.status,
          badgeVariant: r.status === "success" ? "secondary" : "destructive",
        });
      }

      return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Стрічка подій
        </CardTitle>
        <CardDescription>
          Усе, що зробила автономна система за останні 7 днів. Оновлюється кожні 30 с.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Поки немає подій. Коли агенти запрацюють і знайдуть закономірності — тут зʼявиться стрічка наживо.
          </p>
        ) : (
          <ScrollArea className="h-[420px] pr-3">
            <ol className="relative space-y-4 border-l border-border pl-5">
              {items.map((item) => {
                const Icon = item.kind === "insight" && ICON_BY_TYPE[(item.detail.split(" · ")[0] || "").replace(/ /g, "_")]
                  ? ICON_BY_TYPE[(item.detail.split(" · ")[0] || "").replace(/ /g, "_")]
                  : ICON_BY_KIND[item.kind];
                return (
                  <li key={item.id} className="relative">
                    <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                      <Icon className="h-3 w-3 text-primary" />
                    </span>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground leading-snug">{item.title}</p>
                      {item.badge && (
                        <Badge variant={item.badgeVariant ?? "secondary"} className="text-[10px]">
                          {item.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      {formatDistanceToNow(item.ts, { addSuffix: true, locale: uk })}
                    </p>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
