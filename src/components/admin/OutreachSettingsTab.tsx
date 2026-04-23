/**
 * Outreach Settings — редагування `outreach_settings` для активного тенанту.
 *
 * Дозволяє super-admin / tenant-admin керувати:
 *  - активними каналами (reddit/google/telegram/instagram/blog)
 *  - списком публічних Telegram-каналів та параметрами скану
 *  - списком сабреддітів
 *  - ключовими словами «купівельного інтенту» та блок-словами
 *  - денними лімітами по каналах
 *  - стандартним лендингом (URL + UTM-source/medium)
 *
 * Усі поля зберігаються як окремі ключі в outreach_settings.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save, RefreshCw, Settings2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { Json } from "@/integrations/supabase/types";

type ChannelKey = "reddit" | "google" | "telegram" | "instagram" | "blog";

type SettingsForm = {
  active_channels: Record<ChannelKey, boolean>;
  rate_limits: Record<ChannelKey, number>;
  blocked_keywords: string;
  intent_keywords: string;
  reddit_subreddits: string;
  telegram_channels: string;
  telegram_max_channels_per_run: number;
  telegram_max_posts_per_channel: number;
  telegram_min_intent_score: number;
  telegram_internal_lookback_days: number;
  default_landing_url: string;
  default_landing_utm_source: string;
  default_landing_utm_medium: string;
  reddit_posting_enabled: boolean;
  telegram_posting_enabled: boolean;
  instagram_posting_enabled: boolean;
};

const DEFAULTS: SettingsForm = {
  active_channels: {
    reddit: true,
    google: false,
    telegram: false,
    instagram: false,
    blog: false,
  },
  rate_limits: { reddit: 5, google: 8, telegram: 10, instagram: 15, blog: 8 },
  blocked_keywords: "політика, війна, релігія, 18+",
  intent_keywords: "шукаю, порадьте, де купити, що краще",
  reddit_subreddits: "Ukraine, lviv, kyiv",
  telegram_channels: "",
  telegram_max_channels_per_run: 10,
  telegram_max_posts_per_channel: 35,
  telegram_min_intent_score: 0.22,
  telegram_internal_lookback_days: 21,
  default_landing_url: "https://e-marq.lovable.app",
  default_landing_utm_source: "outreach",
  default_landing_utm_medium: "organic",
  reddit_posting_enabled: false,
  telegram_posting_enabled: false,
  instagram_posting_enabled: false,
};

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  reddit: "Reddit",
  google: "Google",
  telegram: "Telegram",
  instagram: "Instagram",
  blog: "Блоги",
};

function csvToList(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function listToCsv(arr: unknown): string {
  if (!Array.isArray(arr)) return "";
  return (arr as string[]).filter(Boolean).join(", ");
}

function parseNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function OutreachSettingsTab() {
  const qc = useQueryClient();
  const { currentTenantId, current } = useTenantContext();
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const settings = useQuery({
    queryKey: ["outreach-settings", currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outreach_settings")
        .select("key, value")
        .eq("tenant_id", currentTenantId!);
      if (error) throw error;
      const map: Record<string, unknown> = {};
      for (const r of data ?? []) map[r.key] = (r as { value: unknown }).value;
      return map;
    },
  });

  // Гідрація форми з БД (один раз після завантаження або при зміні тенанту)
  useEffect(() => {
    if (!settings.data) return;
    const m = settings.data;
    const next: SettingsForm = {
      active_channels: {
        ...DEFAULTS.active_channels,
        ...((m.active_channels as Record<ChannelKey, boolean>) ?? {}),
      },
      rate_limits: {
        ...DEFAULTS.rate_limits,
        ...((m.rate_limits as Record<ChannelKey, number>) ?? {}),
      },
      blocked_keywords: listToCsv(m.blocked_keywords) || DEFAULTS.blocked_keywords,
      intent_keywords: listToCsv(m.intent_keywords) || DEFAULTS.intent_keywords,
      reddit_subreddits: listToCsv(m.reddit_subreddits) || DEFAULTS.reddit_subreddits,
      telegram_channels: listToCsv(m.telegram_channels),
      telegram_max_channels_per_run: parseNumber(
        m.telegram_max_channels_per_run,
        DEFAULTS.telegram_max_channels_per_run,
      ),
      telegram_max_posts_per_channel: parseNumber(
        m.telegram_max_posts_per_channel,
        DEFAULTS.telegram_max_posts_per_channel,
      ),
      telegram_min_intent_score: parseNumber(
        m.telegram_min_intent_score,
        DEFAULTS.telegram_min_intent_score,
      ),
      telegram_internal_lookback_days: parseNumber(
        m.telegram_internal_lookback_days,
        DEFAULTS.telegram_internal_lookback_days,
      ),
      default_landing_url:
        ((m.default_landing as { url?: string })?.url as string) ?? DEFAULTS.default_landing_url,
      default_landing_utm_source:
        ((m.default_landing as { utm_source?: string })?.utm_source as string) ??
        DEFAULTS.default_landing_utm_source,
      default_landing_utm_medium:
        ((m.default_landing as { utm_medium?: string })?.utm_medium as string) ??
        DEFAULTS.default_landing_utm_medium,
      reddit_posting_enabled: Boolean(m.reddit_posting_enabled ?? false),
      telegram_posting_enabled: Boolean(m.telegram_posting_enabled ?? false),
      instagram_posting_enabled: Boolean(m.instagram_posting_enabled ?? false),
    };
    setForm(next);
    setDirty(false);
  }, [settings.data, currentTenantId]);

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const updateChannel = (ch: ChannelKey, active: boolean) => {
    setForm((f) => ({ ...f, active_channels: { ...f.active_channels, [ch]: active } }));
    setDirty(true);
  };

  const updateLimit = (ch: ChannelKey, n: number) => {
    setForm((f) => ({ ...f, rate_limits: { ...f.rate_limits, [ch]: n } }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!currentTenantId) throw new Error("Виберіть бренд");
      const rows: { tenant_id: string; key: string; value: Json }[] = [
        { tenant_id: currentTenantId, key: "active_channels", value: form.active_channels as unknown as Json },
        { tenant_id: currentTenantId, key: "rate_limits", value: form.rate_limits as unknown as Json },
        { tenant_id: currentTenantId, key: "blocked_keywords", value: csvToList(form.blocked_keywords) as unknown as Json },
        { tenant_id: currentTenantId, key: "intent_keywords", value: csvToList(form.intent_keywords) as unknown as Json },
        { tenant_id: currentTenantId, key: "reddit_subreddits", value: csvToList(form.reddit_subreddits) as unknown as Json },
        { tenant_id: currentTenantId, key: "telegram_channels", value: csvToList(form.telegram_channels) as unknown as Json },
        {
          tenant_id: currentTenantId,
          key: "telegram_max_channels_per_run",
          value: form.telegram_max_channels_per_run as unknown as Json,
        },
        {
          tenant_id: currentTenantId,
          key: "telegram_max_posts_per_channel",
          value: form.telegram_max_posts_per_channel as unknown as Json,
        },
        {
          tenant_id: currentTenantId,
          key: "telegram_min_intent_score",
          value: form.telegram_min_intent_score as unknown as Json,
        },
        {
          tenant_id: currentTenantId,
          key: "telegram_internal_lookback_days",
          value: form.telegram_internal_lookback_days as unknown as Json,
        },
        {
          tenant_id: currentTenantId,
          key: "default_landing",
          value: {
            url: form.default_landing_url,
            utm_source: form.default_landing_utm_source,
            utm_medium: form.default_landing_utm_medium,
          } as unknown as Json,
        },
        { tenant_id: currentTenantId, key: "reddit_posting_enabled", value: form.reddit_posting_enabled as unknown as Json },
        { tenant_id: currentTenantId, key: "telegram_posting_enabled", value: form.telegram_posting_enabled as unknown as Json },
        { tenant_id: currentTenantId, key: "instagram_posting_enabled", value: form.instagram_posting_enabled as unknown as Json },
      ];

      const { error } = await supabase
        .from("outreach_settings")
        .upsert(rows, { onConflict: "tenant_id,key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Налаштування збережено");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["outreach-settings"] });
    },
    onError: (e: Error) => toast.error("Не вдалося зберегти", { description: e.message }),
  });

  const isLoading = settings.isLoading;
  const channelKeys = useMemo<ChannelKey[]>(
    () => ["reddit", "google", "telegram", "instagram", "blog"],
    [],
  );

  if (!currentTenantId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Виберіть бренд у перемикачі вгорі — налаштування зберігаються на рівні тенанту.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">
              Налаштування Outreach Hunter
              {current?.tenant_name ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  · {current.tenant_name}
                </span>
              ) : null}
            </CardTitle>
          </div>
          <CardDescription>
            Зміни зберігаються одразу і застосовуються до наступного запуску агентів.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 pt-0">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Зберегти зміни
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={settings.isFetching}
            onClick={() => void settings.refetch()}
          >
            {settings.isFetching ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Скинути до збереженого
          </Button>
          {dirty && (
            <span className="text-xs text-warning">Є незбережені зміни</span>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Активні канали + ліміти */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Активні канали та денні ліміти</CardTitle>
              <CardDescription>
                Тільки увімкнені канали скануються. Ліміт — максимум публікацій/звернень на день.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {channelKeys.map((ch) => (
                <div
                  key={ch}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/50 p-3"
                >
                  <Switch
                    checked={form.active_channels[ch] ?? false}
                    onCheckedChange={(v) => updateChannel(ch, v)}
                    aria-label={`Канал ${CHANNEL_LABEL[ch]}`}
                  />
                  <span className="min-w-20 text-sm font-medium text-foreground">
                    {CHANNEL_LABEL[ch]}
                  </span>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Ліміт/день</Label>
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      value={form.rate_limits[ch] ?? 0}
                      onChange={(e) => updateLimit(ch, Math.max(0, Number(e.target.value) || 0))}
                      className="h-8 w-20"
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Інтенти та блок-слова */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Купівельний інтент і блок-слова</CardTitle>
              <CardDescription>Через кому. Регістр не важливий.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Слова, які підвищують intent (купівельні наміри)
                </Label>
                <Textarea
                  rows={2}
                  value={form.intent_keywords}
                  onChange={(e) => update("intent_keywords", e.target.value)}
                  placeholder="шукаю, порадьте, де купити, що краще"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Блок-слова (повністю фільтруються)
                </Label>
                <Textarea
                  rows={2}
                  value={form.blocked_keywords}
                  onChange={(e) => update("blocked_keywords", e.target.value)}
                  placeholder="політика, війна, релігія, 18+"
                />
              </div>
            </CardContent>
          </Card>

          {/* Reddit */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Reddit</CardTitle>
              <CardDescription>Без r/, через кому.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Сабреддіти для пошуку</Label>
                <Textarea
                  rows={3}
                  value={form.reddit_subreddits}
                  onChange={(e) => update("reddit_subreddits", e.target.value)}
                  placeholder="Ukraine, ukraina, kyiv, lviv"
                />
              </div>
            </CardContent>
          </Card>

          {/* Telegram */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Списки для Telegram</CardTitle>
              <CardDescription>
                Через кому, без https://t.me/ — просто назви каналів.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Публічні канали для пошуку</Label>
                <Textarea
                  rows={3}
                  value={form.telegram_channels}
                  onChange={(e) => update("telegram_channels", e.target.value)}
                  placeholder="dog_ua, tviy_veterynar, houseforanimals"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Скільки каналів перевіряти за один раз
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={form.telegram_max_channels_per_run}
                    onChange={(e) =>
                      update(
                        "telegram_max_channels_per_run",
                        Math.max(1, Number(e.target.value) || 1),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Скільки повідомлень брати з кожного каналу
                  </Label>
                  <Input
                    type="number"
                    min={5}
                    max={200}
                    value={form.telegram_max_posts_per_channel}
                    onChange={(e) =>
                      update(
                        "telegram_max_posts_per_channel",
                        Math.max(5, Number(e.target.value) || 5),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Поріг «це теплий запит» (0–1)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.telegram_min_intent_score}
                    onChange={(e) =>
                      update(
                        "telegram_min_intent_score",
                        Math.max(0, Math.min(1, Number(e.target.value) || 0)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Скільки днів назад дивитися живі Telegram-чати
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={form.telegram_internal_lookback_days}
                    onChange={(e) =>
                      update(
                        "telegram_internal_lookback_days",
                        Math.max(1, Number(e.target.value) || 1),
                      )
                    }
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Так Outreach Hunter зможе знаходити більше реальних запитів від людей, які вже
                писали боту.
              </p>
            </CardContent>
          </Card>

          {/* Лендинг */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Стандартний лендинг для outreach</CardTitle>
              <CardDescription>
                Куди вестимуть посилання у драфтах. Можна перевизначити для кожного бренду.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Лендинг URL</Label>
                <Input
                  type="url"
                  value={form.default_landing_url}
                  onChange={(e) => update("default_landing_url", e.target.value)}
                  placeholder="https://your-brand.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">UTM source</Label>
                  <Input
                    value={form.default_landing_utm_source}
                    onChange={(e) => update("default_landing_utm_source", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">UTM medium</Label>
                  <Input
                    value={form.default_landing_utm_medium}
                    onChange={(e) => update("default_landing_utm_medium", e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Авто-постинг */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Автоматична публікація</CardTitle>
              <CardDescription>
                Якщо вимкнено — драфти лишаються в pending_review для ручного перегляду.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["reddit", "telegram", "instagram"] as const).map((ch) => {
                const key = `${ch}_posting_enabled` as
                  | "reddit_posting_enabled"
                  | "telegram_posting_enabled"
                  | "instagram_posting_enabled";
                return (
                  <div
                    key={ch}
                    className="flex items-center justify-between rounded-md border border-border bg-card/50 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{CHANNEL_LABEL[ch]}</p>
                      <p className="text-xs text-muted-foreground">
                        Дозволити агенту публікувати без апруву
                      </p>
                    </div>
                    <Switch
                      checked={form[key]}
                      onCheckedChange={(v) => update(key, v)}
                      aria-label={`Авто-постинг ${CHANNEL_LABEL[ch]}`}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Sticky save */}
          {dirty && (
            <div className="sticky bottom-3 z-10 flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending} size="lg">
                {save.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Зберегти всі зміни
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
