/**
 * Owner-side card: bind your personal Telegram chat to receive insight/action
 * notifications with Apply/Dismiss buttons. Tells the owner to message the
 * shared bot with a one-time `/start owner <code>` command — the poll loop will save chat_id.
 *
 * Also lets owner unbind (clear chat_id) if they want to stop notifications.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, BellOff, Copy, Send, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureAuthenticatedSession } from "@/lib/auth/ensureSession";

type Props = { tenantId: string; tenantSlug: string };

function getPairingCode(value: unknown) {
  if (value && typeof value === "object" && "pairing_code" in value) {
    const pairingCode = value.pairing_code;
    return typeof pairingCode === "string" ? pairingCode : null;
  }
  return null;
}

export function OwnerTelegramBindCard({ tenantId }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["owner-tg-binding", tenantId],
    queryFn: async () => {
      const [{ data: cfg }, { data: recent }, { data: pairing }] = await Promise.all([
        supabase
          .from("tenant_configs")
          .select("owner_telegram_chat_id")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("owner_telegram_outbox")
          .select("source_kind, status, sent_at, error, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("telegram_owner_pairings")
          .select("pairing_code, expires_at")
          .eq("tenant_id", tenantId)
          .is("consumed_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        chatId: cfg?.owner_telegram_chat_id ?? null,
        recent: recent ?? [],
        pairing: pairing ?? null,
      };
    },
  });

  const isBound = !!data?.chatId;
  const activePairingCode = pairingCode ?? data?.pairing?.pairing_code ?? null;
  const startCommand = activePairingCode ? `/start owner ${activePairingCode}` : "";
  const botLink = activePairingCode
    ? `https://t.me/Oauther_bot?start=owner_${activePairingCode}`
    : null;

  const handleCreatePairing = async () => {
    setBusy(true);
    try {
      await ensureAuthenticatedSession();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Сесія не знайдена");
      return;
    }
    const { data, error } = await supabase.rpc("create_telegram_owner_pairing", {
      _tenant_id: tenantId,
    });
    setBusy(false);
    if (error) {
      toast.error("Не вдалося створити код Telegram", { description: error.message });
      return;
    }
    setPairingCode(getPairingCode(data));
    toast.success("Код створено. Відкрийте бота або скопіюйте команду.");
    qc.invalidateQueries({ queryKey: ["owner-tg-binding", tenantId] });
  };

  const handleCopy = async () => {
    if (!startCommand) {
      await handleCreatePairing();
      return;
    }
    await navigator.clipboard.writeText(startCommand);
    toast.success("Скопійовано — вставте в чат із ботом");
  };

  const handleUnbind = async () => {
    if (!confirm("Перестати отримувати сповіщення в Telegram для цього магазину?")) return;
    setBusy(true);
    try {
      await ensureAuthenticatedSession();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Сесія не знайдена");
      return;
    }
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
    try {
      await ensureAuthenticatedSession();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Сесія не знайдена");
      return;
    }
    const { error } = await supabase.rpc("create_owner_test_notification", {
      _tenant_id: tenantId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Надіслано — перевірте Telegram за кілька секунд");
    setTimeout(() => refetch(), 4000);
  };

  const STATUS_LABEL: Record<string, string> = {
    sent: "надіслано",
    failed: "помилка",
    queued: "у черзі",
    pending: "очікує",
  };
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
            <Badge variant="outline" className="border-success/40 text-success">
              підключено
            </Badge>
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
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading…">
            <div className="h-12 animate-pulse rounded-md bg-primary/10" />
            <div className="flex gap-2">
              <div className="h-8 w-28 animate-pulse rounded-md bg-primary/10" />
              <div className="h-8 w-20 animate-pulse rounded-md bg-primary/10" />
            </div>
          </div>
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
                      <span className="text-muted-foreground">
                        {KIND_LABEL[r.source_kind] ?? r.source_kind}
                      </span>
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
              <li>Створіть одноразовий код для безпечної привʼязки власника.</li>
              <li>Відкрийте @Oauther_bot кнопкою нижче або надішліть команду вручну.</li>
              <li>Бот відповість, і ваш чат автоматично прив'яжеться тут.</li>
            </ol>
            {activePairingCode ? (
              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="mb-2 text-muted-foreground">Команда для Telegram</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-foreground">
                    {startCommand}
                  </code>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={handleCopy}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {botLink ? (
                <Button size="sm" asChild>
                  <a href={botLink} target="_blank" rel="noreferrer">
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Відкрити бота
                  </a>
                </Button>
              ) : (
                <Button size="sm" onClick={handleCreatePairing} disabled={busy}>
                  {busy ? (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Створити код
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={busy}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Перевірити підключення
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
