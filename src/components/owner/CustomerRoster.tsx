import { useQuery } from "@tanstack/react-query";
import { Crown, Mail, MessageCircle, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type CustomerRow = {
  id: string;
  email: string | null;
  name: string | null;
  telegram_username: string | null;
  telegram_chat_id: string | null;
  lifecycle_stage: string;
  total_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  predicted_next_order_at: string | null;
};

const STAGE_STYLE: Record<string, string> = {
  vip: "bg-warning/15 text-warning-foreground border-warning/40",
  active: "bg-success/15 text-success border-success/40",
  new: "bg-primary/10 text-primary border-primary/30",
  at_risk: "bg-destructive/10 text-destructive border-destructive/30",
  dormant: "bg-muted text-muted-foreground",
};

export function CustomerRoster({ tenantId }: Props) {
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customer-roster", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, email, name, telegram_username, telegram_chat_id, lifecycle_stage, total_orders, total_spent_cents, last_order_at, predicted_next_order_at")
        .eq("tenant_id", tenantId)
        .order("total_spent_cents", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CustomerRow[];
    },
    refetchInterval: 30_000,
  });

  const totals = {
    count: customers.length,
    vip: customers.filter((c) => c.lifecycle_stage === "vip").length,
    withTg: customers.filter((c) => c.telegram_chat_id).length,
    ltv: customers.reduce((s, c) => s + c.total_spent_cents, 0),
    overdue: customers.filter((c) => c.predicted_next_order_at && new Date(c.predicted_next_order_at) < new Date()).length,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Customer roster
        </CardTitle>
        <CardDescription>
          Who the system knows about and what it predicts for them.
        </CardDescription>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Customers" value={totals.count} />
          <Mini label="VIPs" value={totals.vip} />
          <Mini label="Reachable on TG" value={totals.withTg} />
          <Mini label="Overdue to reorder" value={totals.overdue} highlight />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : customers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No customers yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Customers appear here automatically when orders are paid.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[480px] pr-3">
            <div className="space-y-2">
              {customers.map((c) => {
                const stage = STAGE_STYLE[c.lifecycle_stage] ?? STAGE_STYLE.new;
                const overdue =
                  c.predicted_next_order_at && new Date(c.predicted_next_order_at) < new Date();
                return (
                  <div key={c.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      {c.lifecycle_stage === "vip" && <Crown className="h-3.5 w-3.5 text-warning-foreground" />}
                      <p className="text-sm font-medium text-foreground">
                        {c.name ?? c.email ?? (c.telegram_username ? `@${c.telegram_username}` : "anonymous")}
                      </p>
                      <Badge variant="outline" className={`ml-auto text-[10px] ${stage}`}>
                        {c.lifecycle_stage}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {c.email && <span className="truncate">{c.email}</span>}
                      {c.telegram_chat_id && (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <MessageCircle className="h-3 w-3" /> Telegram
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">Orders</span>
                        <p className="font-medium text-foreground">{c.total_orders}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">LTV</span>
                        <p className="font-medium text-foreground">${(c.total_spent_cents / 100).toFixed(0)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Next order</span>
                        <p className={`font-medium ${overdue ? "text-destructive" : "text-foreground"}`}>
                          {c.predicted_next_order_at ? new Date(c.predicted_next_order_at).toLocaleDateString() : "—"}
                        </p>
                      </div>
                    </div>
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

function Mini({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
