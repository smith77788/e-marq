/**
 * Top customers panel — top 10 by lifetime value with manual winback trigger.
 *
 * Shows lifecycle badge, days since last order (red if overdue based on
 * predicted_next_order_at), and a one-click "Send winback" button that hits
 * /hooks/engines/winback-one for that specific customer.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Send, AlertCircle, Loader2, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DetailableElement } from "@/components/detail";
import { fetchCustomerDetail } from "@/components/detail/builders";

type Props = { tenantId: string };

type Customer = {
  id: string;
  name: string | null;
  email: string | null;
  total_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  predicted_next_order_at: string | null;
  lifecycle_stage: string;
  consent_marketing: boolean;
  telegram_chat_id: string | null;
};

const STAGE_VARIANT: Record<string, { label: string; cls: string }> = {
  vip: { label: "VIP", cls: "bg-primary/15 text-primary border-primary/30" },
  active: {
    label: "активний",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  at_risk: {
    label: "ризик піти",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  new: { label: "новий", cls: "bg-muted text-muted-foreground border-border" },
};

function fmtUsd(cents: number) {
  return `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;
}
function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function TopCustomers({ tenantId }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const {
    data: customers,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["top-customers", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, name, email, total_orders, total_spent_cents, last_order_at, predicted_next_order_at, lifecycle_stage, consent_marketing, telegram_chat_id",
        )
        .eq("tenant_id", tenantId)
        .order("total_spent_cents", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  async function sendWinback(customer: Customer) {
    setBusy(customer.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/hooks/engines/winback-one", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ tenant_id: tenantId, customer_id: customer.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Не вдалося надіслати");
      toast.success(`Повернення клієнта надіслано через ${json.channel}`, {
        description: `Доставлено одразу: ${json.dispatched ?? 0}`,
      });
      refetch();
    } catch (e) {
      toast.error("Не вдалося надіслати", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Crown className="h-4 w-4 text-primary" />
          Найкращі клієнти (за сумою покупок)
        </CardTitle>
        <CardDescription className="text-xs">
          Поверніть найцінніших покупців одним натисканням.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted/30" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Не вдалося завантажити.{" "}
            <button type="button" className="underline" onClick={() => void refetch()}>
              Повторити
            </button>
          </p>
        ) : !customers || customers.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={Users}
            title="Поки немає клієнтів"
            description="Завантажте демо-дані або зачекайте на перші замовлення — список оновиться автоматично."
          />
        ) : (
          <div className="space-y-1.5">
            {customers.map((c) => {
              const stage = STAGE_VARIANT[c.lifecycle_stage] ?? STAGE_VARIANT.new;
              const since = daysSince(c.last_order_at);
              const overdue = c.predicted_next_order_at
                ? new Date(c.predicted_next_order_at).getTime() < Date.now()
                : false;
              const reachable = !!c.email || !!c.telegram_chat_id;
              const canMessage = c.consent_marketing && reachable;
              return (
                <DetailableElement
                  key={c.id}
                  elementId={c.id}
                  resourceType="customer"
                  drawerTitle={c.name ?? c.email ?? "Анонім"}
                  fetchDetail={() => fetchCustomerDetail(tenantId, c.id)}
                  staleTime={60_000}
                  ariaLabel={`Профіль клієнта ${c.name ?? c.email ?? "анонім"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {c.name ?? c.email ?? "Анонім"}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {c.total_orders} замовлень · {fmtUsd(c.total_spent_cents)}
                          {since !== null && (
                            <span
                              className={
                                overdue ? "ml-1 text-amber-600 dark:text-amber-400" : "ml-1"
                              }
                            >
                              · {since} дн. тому{overdue ? " (час нагадати)" : ""}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${stage.cls}`}>
                        {stage.label}
                      </Badge>
                      <Button
                        size="sm"
                        variant={overdue ? "default" : "outline"}
                        disabled={!canMessage || busy === c.id}
                        onClick={() => sendWinback(c)}
                        className="h-7 gap-1 text-xs"
                        title={
                          !canMessage
                            ? c.consent_marketing
                              ? "Немає каналу для звʼязку"
                              : "Клієнт відмовився від розсилок"
                            : "Надіслати персональне нагадування від ШІ"
                        }
                      >
                        {busy === c.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : !canMessage ? (
                          <AlertCircle className="h-3 w-3" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        Повернути
                      </Button>
                    </div>
                  </div>
                </DetailableElement>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
