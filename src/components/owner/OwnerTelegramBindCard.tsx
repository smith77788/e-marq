/**
 * Owner-side card: bind your personal Telegram chat to receive insight/action
 * notifications with Apply/Dismiss buttons. Tells the owner to message the
 * shared bot with `/start owner <slug>` — the poll loop will save chat_id.
 *
 * Also lets owner unbind (clear chat_id) if they want to stop notifications.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, BellOff, Send, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = { tenantId: string; tenantSlug: string };

export function OwnerTelegramBindCard({ tenantId, tenantSlug }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["owner-tg-binding", tenantId],
    queryFn: async () => {
      const { data: cfg } = await supabase
        .from("tenant_configs")
        .select("owner_telegram_chat_id")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const { data: recent } = await supabase
        .from("owner_telegram_outbox")
        .select("source_kind, status, sent_at, error, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(5);
      return {
        chatId: cfg?.owner_telegram_chat_id ?? null,
        recent: recent ?? [],
      };
    },
  });

  const isBound = !!data?.chatId;
  const startCommand = `/start owner ${tenantSlug}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(startCommand);
    toast.success("Скопійовано — вставте в чат із ботом");
  };

  const handleUnbind = async () => {
    if (!confirm("Перестати отримувати сповіщення в Telegram для цього магазину?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_owner_telegram_chat", {
      _tenant_id: tenantId,
      _chat_id: "",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Telegram відʼєднано");
    qc.invalidateQueries({ queryKey: ["owner-tg-binding", tenantId] });
  };

  const handleTest = async () => {
    setBusy(true);
    const { error } = await supabase.from("owner_notifications").insert({
      tenant_id: tenantId,
      kind: "test_ping",
      title: "Тестове сповіщення з кабінету",
      body: "Якщо ви бачите це в Telegram із кнопками — інтеграція працює ✅",
      severity: "high",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Надіслано — перевірте Telegram за кілька секунд");
    setTimeout(() => refetch(), 4000);
  };

  const STATUS_LABEL: Record<string, string> = { sent: "надіслано", failed: "помилка", queued: "у черзі", pending: "очікує" };
  const KIND_LABEL: Record<string, string> = {
    insight: "підказка",
    test_ping: "тестове",
    pending_action: "дія агента",
    dntrade_unhealthy: "DN Trade недоступний",
    dntrade_partial_repeat: "DN Trade збої",
    dntrade_weekly_digest: "тижневий звіт DN Trade",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {isBound ? (
            <Bell className="h-4 w-4 text-success" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          Сповіщення в Telegram для власника
          {isBound ? (
            <Badge variant="outline" className="border-success/40 text-success">підключено</Badge>
          ) : (
            <Badge variant="outline">не підключено</Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Отримуйте підказки та дії агентів прямо в особистий Telegram із кнопками{" "}
          <b>Застосувати</b> / <b>Відхилити</b> / <b>Переглянути</b>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Завантаження…</p>
        ) : isBound ? (
          <>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ID вашого чату</span>
                <code className="font-mono text-foreground">{data!.chatId}</code>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={handleTest} disabled={busy}>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Надіслати тест
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={busy}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Оновити
              </Button>
              <Button size="sm" variant="ghost" onClick={handleUnbind} disabled={busy}>
                Відʼєднати
              </Button>
            </div>
            {data!.recent.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Останні сповіщення
                </p>
                <div className="space-y-1">
                  {data!.recent.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded border border-border/50 px-2 py-1 text-xs"
                    >
                      <span className="text-muted-foreground">{KIND_LABEL[r.source_kind] ?? r.source_kind}</span>
                      <Badge
                        variant="outline"
                        className={
                          r.status === "sent"
                            ? "border-success/40 text-success"
                            : r.status === "failed"
                              ? "border-destructive/40 text-destructive"
                              : ""
                        }
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Відкрийте того ж Telegram-бота, яким користуються ваші клієнти.</li>
              <li>
                Надішліть цю команду:{" "}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="font-mono text-foreground underline decoration-dotted hover:text-primary"
                >
                  {startCommand}
                </button>{" "}
                (натисніть, щоб скопіювати).
              </li>
              <li>Бот відповість, і ваш чат автоматично прив'яжеться тут.</li>
            </ol>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Я надіслав команду — перевірте зараз
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
