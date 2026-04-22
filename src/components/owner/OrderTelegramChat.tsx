/**
 * Telegram chat panel inside an order detail Sheet.
 *
 * Shows the recent two-way conversation thread with the order's customer
 * (Telegram only) and lets the operator send a message via the shared bot
 * by POSTing to `/api/orders/$orderId/telegram-message`.
 *
 * The customer's replies are written into `conversations` by the existing
 * Telegram long-poll endpoint, so this panel just refetches every few seconds
 * while open.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

type ConversationRow = {
  id: string;
  body: string;
  direction: string;
  created_at: string;
};

export function OrderTelegramChat({
  orderId,
  tenantId,
  customerEmail,
  customerUserId,
}: {
  orderId: string;
  tenantId: string;
  customerEmail: string | null;
  customerUserId: string | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const customerQuery = useQuery({
    queryKey: ["order-tg-customer", tenantId, customerUserId, customerEmail],
    enabled: !!(customerUserId || customerEmail),
    queryFn: async () => {
      let q = supabase
        .from("customers")
        .select("id, telegram_chat_id")
        .eq("tenant_id", tenantId)
        .not("telegram_chat_id", "is", null)
        .limit(1);
      if (customerUserId) q = q.eq("user_id", customerUserId);
      else if (customerEmail) q = q.ilike("email", customerEmail);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const customerId = customerQuery.data?.id ?? null;
  const linked = !!customerQuery.data?.telegram_chat_id;

  const threadQuery = useQuery<ConversationRow[]>({
    queryKey: ["order-tg-thread", customerId],
    enabled: !!customerId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, body, direction, created_at")
        .eq("customer_id", customerId!)
        .eq("channel", "telegram")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as ConversationRow[]).reverse();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Сесія не активна");
      const res = await fetch(`/api/orders/${orderId}/telegram-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    },
    onSuccess: () => {
      setDraft("");
      toast.success("Надіслано в Telegram");
      qc.invalidateQueries({ queryKey: ["order-tg-thread", customerId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!customerEmail && !customerUserId) {
    return (
      <p className="text-xs text-muted-foreground">
        У замовлення немає email клієнта — двосторонній чат недоступний.
      </p>
    );
  }

  if (customerQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Шукаю прив'язку Telegram…</p>;
  }

  if (!linked) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Покупець ще не прив'язав Telegram до бренду. Попросіть його надіслати команду
        <code className="mx-1 rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          /start &lt;ваш-slug&gt;
        </code>
        нашому боту — після цього тут зʼявиться чат.
      </div>
    );
  }

  const thread = threadQuery.data ?? [];

  return (
    <div className="space-y-3">
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/10 p-3">
        {thread.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            Поки немає повідомлень. Напишіть першим — клієнт отримає в Telegram.
          </p>
        ) : (
          thread.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <div
                key={m.id}
                className={`flex ${outbound ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                    outbound
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground border border-border"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${outbound ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {format(new Date(m.created_at), "dd MMM, HH:mm")}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Напишіть клієнту у Telegram…"
        rows={3}
        className="text-sm"
        maxLength={3000}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          Підтримує HTML: &lt;b&gt;, &lt;i&gt;, &lt;a href&gt;
        </span>
        <Button
          size="sm"
          onClick={() => sendMutation.mutate(draft.trim())}
          disabled={!draft.trim() || sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Надіслати
        </Button>
      </div>
    </div>
  );
}
