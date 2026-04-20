import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bot, CheckCircle2, Clock, Loader2, MessageCircle, Send, TrendingUp, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

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
  pending: { label: "Queued", cls: "bg-muted text-muted-foreground", Icon: Clock },
  sent: { label: "Sent", cls: "bg-primary/10 text-primary border-primary/30", Icon: Send },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: XCircle },
  replied: { label: "Replied", cls: "bg-warning/15 text-warning-foreground border-warning/40", Icon: MessageCircle },
  converted: { label: "Converted", cls: "bg-success/15 text-success border-success/40", Icon: CheckCircle2 },
};

const TRIGGER_LABEL: Record<string, string> = {
  reorder: "Reorder ping",
  winback: "Winback",
  abandoned_cart: "Cart recovery",
  sales_reply: "Sales reply",
};

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
    refetchInterval: 15_000,
  });

  const runReorder = useMutation({
    mutationFn: () => authedFetch("/hooks/engines/reorder", { tenant_id: tenantId }),
    onSuccess: (r) => {
      const sent = (r as { sent?: number }).sent ?? 0;
      const queued = (r as { queued?: number }).queued ?? 0;
      toast.success(`Reorder engine: ${queued} queued, ${sent} sent`);
      qc.invalidateQueries({ queryKey: ["revenue-feed", tenantId] });
      qc.invalidateQueries({ queryKey: ["revenue-stats", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatch = useMutation({
    mutationFn: () => authedFetch("/hooks/engines/dispatch", { tenant_id: tenantId }),
    onSuccess: (r) => {
      toast.success(`Dispatched ${(r as { sent?: number }).sent ?? 0} pending messages`);
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
              Revenue feed
            </CardTitle>
            <CardDescription>
              What the system did for you. Auto-refreshes every 15s.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runReorder.mutate()} disabled={runReorder.isPending} size="sm">
              {runReorder.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-2 h-3.5 w-3.5" />}
              Run reorder engine now
            </Button>
            <Button onClick={() => dispatch.mutate()} disabled={dispatch.isPending} size="sm" variant="outline">
              {dispatch.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
              Send queued
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Sent" value={stats.sent} />
          <Stat label="Replies" value={stats.replied} />
          <Stat label="Converted" value={stats.converted} />
          <Stat label="Pipeline" value={`$${(stats.pipeline / 100).toFixed(0)}`} sub="expected" highlight />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <Bot className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No autonomous activity yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Run reorder engine now" — system will check who's overdue and message them on Telegram.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[560px] pr-3">
            <div className="space-y-2">
              {rows.map((r) => {
                const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
                const StatusIcon = s.Icon;
                const customerLabel =
                  r.customers?.name ?? r.customers?.email ?? (r.customers?.telegram_username ? `@${r.customers.telegram_username}` : "anonymous");
                const ts = r.sent_at ?? r.scheduled_for;
                return (
                  <div key={r.id} className="rounded-lg border border-border bg-card p-3">
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
                        <TrendingUp className="h-3 w-3" /> potential ${(r.expected_impact_cents / 100).toFixed(0)}
                      </p>
                    )}
                  </div>
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
