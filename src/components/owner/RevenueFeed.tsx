import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bot, CheckCircle2, Clock, Loader2, MessageCircle, Send, TrendingUp, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/money";
import { DetailableElement } from "@/components/detail";
import { buildOutboundPayload } from "@/components/detail/builders";

type Props = { tenantId: string };

type OutboundRow = {
  id: string;
  channel: string;
  trigger_kind: string;
  body: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  replied_at: string | null;
  converted_at: string | null;
  expected_impact_cents: number | null;
  actual_revenue_cents: number | null;
  customer_id: string | null;
  customers?: { name: string | null; email: string | null; telegram_username: string | null } | null;
};

const STATUS_STYLE: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  pending: { label: "У черзі", cls: "bg-muted text-muted-foreground", Icon: Clock },
  sent: { label: "Надіслано", cls: "bg-primary/10 text-primary border-primary/30", Icon: Send },
  failed: { label: "Помилка", cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: XCircle },
  replied: { label: "Відповіли", cls: "bg-warning/15 text-warning-foreground border-warning/40", Icon: MessageCircle },
  converted: { label: "Куплено", cls: "bg-success/15 text-success border-success/40", Icon: CheckCircle2 },
};

const TRIGGER_LABEL: Record<string, string> = {
  reorder: "Повторне замовлення",
  winback: "Повернення клієнта",
  abandoned_cart: "Покинутий кошик",
  sales_reply: "Відповідь продавця",
};

type EngineButton = { kind: "reorder" | "abandoned-cart" | "winback"; label: string; toast: string };
const ENGINES: EngineButton[] = [
  { kind: "reorder", label: "Повторні", toast: "Повторні замовлення" },
  { kind: "abandoned-cart", label: "Кошики", toast: "Покинуті кошики" },
  { kind: "winback", label: "Повернення", toast: "Повернення клієнтів" },
];

async function authedFetch(path: string, body: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: string; details?: string };
  if (!res.ok || json.success === false) {
    throw new Error(typeof json.details === "string" ? json.details : typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export function RevenueFeed({ tenantId }: Props) {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["revenue-feed", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outbound_messages")
        .select(
          "id, channel, trigger_kind, body, status, scheduled_for, sent_at, replied_at, converted_at, expected_impact_cents, actual_revenue_cents, customer_id, customers(name, email, telegram_username)",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as unknown as OutboundRow[];
    },
    refetchInterval: 30_000,
  });

  // Realtime: refresh feed instantly when outbound rows change for this tenant.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`revenue-feed-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outbound_messages", filter: `tenant_id=eq.${tenantId}` },
        () => qc.invalidateQueries({ queryKey: ["revenue-feed", tenantId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, qc]);

  const runEngine = useMutation({
    mutationFn: async (kind: EngineButton["kind"]) => {
      const r = await authedFetch(`/hooks/engines/${kind}`, { tenant_id: tenantId });
      return { kind, result: r };
    },
    onSuccess: ({ kind, result }) => {
      const r = result as { sent?: number; queued?: number };
      const eng = ENGINES.find((e) => e.kind === kind);
      toast.success(`${eng?.toast}: ${r.queued ?? 0} у черзі, ${r.sent ?? 0} надіслано`);
      qc.invalidateQueries({ queryKey: ["revenue-feed", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatch = useMutation({
    mutationFn: () => authedFetch("/hooks/engines/dispatch", { tenant_id: tenantId }),
    onSuccess: (r) => {
      toast.success(`Надіслано ${(r as { sent?: number }).sent ?? 0} повідомлень із черги`);
      qc.invalidateQueries({ queryKey: ["revenue-feed", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = {
    sent: rows.filter((r) => r.status === "sent" || r.status === "replied" || r.status === "converted").length,
    replied: rows.filter((r) => r.status === "replied" || r.status === "converted").length,
    converted: rows.filter((r) => r.status === "converted").length,
    revenue: rows.reduce((s, r) => s + (r.actual_revenue_cents ?? 0), 0),
    pipeline: rows.filter((r) => r.status === "sent" || r.status === "replied").reduce((s, r) => s + (r.expected_impact_cents ?? 0), 0),
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Що приніс ШІ
            </CardTitle>
            <CardDescription>
              Дії автономних агентів. Оновлюється кожні 15 секунд.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {ENGINES.map((e) => (
              <Button
                key={e.kind}
                onClick={() => runEngine.mutate(e.kind)}
                disabled={runEngine.isPending}
                size="sm"
                variant={e.kind === "reorder" ? "default" : "outline"}
              >
                {runEngine.isPending && runEngine.variables === e.kind ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-3.5 w-3.5" />
                )}
                {e.label}
              </Button>
            ))}
            <Button onClick={() => dispatch.mutate()} disabled={dispatch.isPending} size="sm" variant="ghost">
              {dispatch.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
              Надіслати чергу
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Надіслано" value={stats.sent} />
          <Stat label="Відповіді" value={stats.replied} />
          <Stat label="Куплено" value={stats.converted} />
          <Stat label="Очікуваний дохід" value={formatMoney(stats.pipeline)} sub="прогноз" highlight />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <Bot className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">Поки що автономної активності немає</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Натисніть «Повторні» — система знайде клієнтів, у яких пора замовити, і напише їм у Telegram.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[560px] pr-3">
            <div className="space-y-2">
              {rows.map((r) => {
                const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
                const StatusIcon = s.Icon;
                const customerLabel =
                  r.customers?.name ?? r.customers?.email ?? (r.customers?.telegram_username ? `@${r.customers.telegram_username}` : "анонім");
                const ts = r.sent_at ?? r.scheduled_for;
                return (
                  <DetailableElement
                    key={r.id}
                    elementId={r.id}
                    resourceType="outbound"
                    drawerTitle={TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind}
                    payload={buildOutboundPayload(r)}
                    ariaLabel={`Відкрити деталі повідомлення ${customerLabel}`}
                  >
                    <div className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] ${s.cls}`}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {s.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{r.channel}</Badge>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(ts), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-foreground">→ {customerLabel}</p>
                      <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground line-clamp-3">
                        {r.body.replace(/<[^>]+>/g, "")}
                      </p>
                      {r.expected_impact_cents != null && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                          <TrendingUp className="h-3 w-3" /> потенціал {formatMoney(r.expected_impact_cents)}
                        </p>
                      )}
                    </div>
                  </DetailableElement>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: number | string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
