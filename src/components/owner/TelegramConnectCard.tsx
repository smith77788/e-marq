/**
 * TelegramConnectCard — owner / admin картка для підключення Telegram-бота
 * та керування його використанням у Lead Radar / Outreach Hunter.
 *
 * Логіка:
 *  - GET /api/telegram/status?tenant=<id> → connected + outreach_*_enabled
 *  - POST /api/telegram/status з action="enable_outreach" | "disable_outreach"
 *  - Якщо connector не підключений — показуємо інструкцію + кнопку
 *    "Підключити Telegram" (відкриває налаштування Lovable Cloud).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, MessageSquare, Plug, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

type Status = {
  connected: boolean;
  bot_username: string | null;
  bot_name: string | null;
  bot_id: number | null;
  outreach_telegram_enabled: boolean;
  outreach_instagram_enabled: boolean;
  error?: string;
  hint?: string;
};

type Props = {
  tenantId: string;
  /** Якщо true — компактний вигляд без CardHeader (для inline-вставки). */
  compact?: boolean;
};

export function TelegramConnectCard({ tenantId, compact = false }: Props) {
  const qc = useQueryClient();
  const [includeInstagram, setIncludeInstagram] = useState(false);

  const status = useQuery({
    queryKey: ["telegram-status", tenantId],
    queryFn: async (): Promise<Status> => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Спочатку увійдіть у кабінет");
      const r = await fetch(`/api/telegram/status?tenant=${tenantId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = (await r.json().catch(() => ({}))) as Status & { error?: string };
      // Сервер повертає 200 навіть коли бот не підключено (з полями error/hint).
      // Тільки 4xx/5xx означає справжню проблему — лише тоді кидаємо.
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      return j;
    },
    refetchInterval: (q) => (q.state.data?.connected ? 60_000 : 15_000),
    staleTime: 10_000,
  });

  // Default: пропонуємо одночасно вмикати і Instagram, якщо телеграм-канал готовий
  useEffect(() => {
    if (status.data?.outreach_instagram_enabled) setIncludeInstagram(true);
  }, [status.data?.outreach_instagram_enabled]);

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Спочатку увійдіть у кабінет");
      const r = await fetch(`/api/telegram/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          action: enable ? "enable_outreach" : "disable_outreach",
          include_instagram: includeInstagram,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return enable;
    },
    onSuccess: (enable) => {
      toast.success(
        enable ? "Telegram-агенти увімкнено для цього магазину" : "Telegram-агенти вимкнено",
      );
      qc.invalidateQueries({ queryKey: ["telegram-status", tenantId] });
    },
    onError: (e: Error) =>
      toast.error("Не вдалося оновити налаштування", { description: e.message }),
  });

  const Body = (
    <div className="space-y-4">
      {status.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Перевіряю стан Telegram-бота…
        </div>
      ) : status.data?.connected ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-success/40 bg-success/10 text-success">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Підключено
            </Badge>
            <span className="text-sm font-medium text-foreground">
              {status.data.bot_name}
              {status.data.bot_username && (
                <a
                  href={`https://t.me/${status.data.bot_username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-primary hover:underline"
                >
                  @{status.data.bot_username}
                </a>
              )}
            </span>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Telegram-агенти в Lead Radar / Outreach Hunter
                </p>
                <p className="text-xs text-muted-foreground">
                  Шукають публічні запити в Telegram-каналах і відповідають через ваш бот
                  автоматично.
                </p>
              </div>
              <Switch
                checked={status.data.outreach_telegram_enabled}
                disabled={toggle.isPending}
                onCheckedChange={(v) => toggle.mutate(v)}
                aria-label="Увімкнути Telegram-агенти"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeInstagram}
                onChange={(e) => setIncludeInstagram(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              Заразом вмикати/вимикати Instagram-агенти
              {status.data.outreach_instagram_enabled && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  активний
                </Badge>
              )}
            </label>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
            Все відбувається в межах сайту: пошук, генерація відповідей, надсилання — без переходу в
            окремі панелі.
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-warning/40 text-warning">
              <Plug className="mr-1 h-3.5 w-3.5" /> Не підключено
            </Badge>
            <span className="text-sm text-muted-foreground">
              {status.data?.error ?? "Telegram-конектор ще не активовано."}
            </span>
          </div>
          {status.data?.hint && <p className="text-xs text-muted-foreground">{status.data.hint}</p>}
          <ol className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <li>
              1. У <span className="font-semibold text-foreground">@BotFather</span> створіть бота
              командою <code>/newbot</code> і скопіюйте токен.
            </li>
            <li>
              2. Натисніть «Підключити Telegram» нижче — Lovable Cloud надійно збереже токен і
              автоматично оновлюватиме його.
            </li>
            <li>
              3. Поверніться сюди й увімкніть Telegram-агенти однією кнопкою — все працюватиме прямо
              в кабінеті.
            </li>
          </ol>
          <Button asChild className="w-full sm:w-auto">
            <a href="/brand/integrations">
              <Plug className="mr-1.5 h-4 w-4" />
              Підключити Telegram
              <ExternalLink className="ml-1.5 h-3.5 w-3.5 opacity-70" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["telegram-status", tenantId] })}
          >
            Оновити стан
          </Button>
        </>
      )}
    </div>
  );

  if (compact) {
    return <div className="rounded-lg border border-border bg-card p-4">{Body}</div>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-primary" />
          Telegram-бот для агентів
        </CardTitle>
        <CardDescription>
          Підключіть власного бота — Lead Radar та Outreach Hunter автоматично надсилатимуть
          відповіді й листування з кабінету.
        </CardDescription>
      </CardHeader>
      <CardContent>{Body}</CardContent>
    </Card>
  );
}
