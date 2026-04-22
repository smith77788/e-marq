import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, ExternalLink, MessageCircle, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string; tenantSlug: string };

const SHARED_BOT_USERNAME = "Oauther_bot"; // Lovable shared connector bot

export function ChannelSetup({ tenantId, tenantSlug }: Props) {
  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const deepLink = `https://t.me/${SHARED_BOT_USERNAME}?start=${tenantSlug}`;

  // Count how many customers have already bound a Telegram chat
  const { data: connectedCount } = useQuery({
    queryKey: ["tg-routing-count", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { count } = await supabase
        .from("telegram_chat_routing")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      return count ?? 0;
    },
    refetchInterval: 15_000,
  });

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} скопійовано`));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          Telegram канал
        </CardTitle>
        <CardDescription>
          Ваші клієнти спілкуються з вашим брендом через спільного безпечного бота Lovable. Не треба
          створювати власного бота — просто поширюйте посилання.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            Бот <strong>@{SHARED_BOT_USERNAME}</strong> готовий приймати клієнтів.
            {typeof connectedCount === "number" && (
              <>
                {" "}
                <Users className="inline h-3.5 w-3.5" /> Підключено клієнтів:{" "}
                <strong>{connectedCount}</strong>
              </>
            )}
          </span>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            1. Поширюйте це посилання у соцмережах / на сайті / у чек-аутах:
          </div>
          <div className="flex gap-2">
            <Input readOnly value={deepLink} className="font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(deepLink, "Посилання")}
              aria-label="Копіювати посилання"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a
                href={deepLink}
                target="_blank"
                rel="noreferrer"
                aria-label="Відкрити посилання у новій вкладці"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Коли клієнт натискає це посилання та натискає <code>START</code> у боті — він
            автоматично прив&apos;язується до вашого магазину. Усі майбутні нагадування, відповіді
            на питання та чек-аут-лінки приходять до нього.
          </p>
        </div>

        <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground">Як це виглядає для клієнта:</div>
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              Клік на посилання → відкривається бот <code>@{SHARED_BOT_USERNAME}</code>
            </li>
            <li>Кнопка «START» → бот вітає від імені вашого бренду</li>
            <li>Можна писати запитання — sales-bot відповідає за хвилину</li>
            <li>Бот сам пропонує повторні замовлення, нагадує покинутий кошик</li>
          </ol>
        </div>

        {origin && (
          <div className="text-[10px] text-muted-foreground/70 font-mono break-all">
            Адреса для відстеження: {origin}/track/{tenantSlug}.js
          </div>
        )}
      </CardContent>
    </Card>
  );
}
