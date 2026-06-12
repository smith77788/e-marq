/**
 * Store Settings — самостійна сторінка для редагування основних
 * параметрів магазину власником бренду. Спирається на існуючу таблицю
 * tenant_configs (brand_name, ui jsonb, seo jsonb, bot jsonb).
 *
 * Не дублює складний адмінський TenantConfigForm — це спрощений редактор
 * для щоденного використання власником: ім'я бренду, кольори, лого, SEO,
 * привітальне повідомлення бота.
 */
import { useEffect, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bot,
  CreditCard,
  FileText,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  MapPin,
  Megaphone,
  Palette,
  Plus,
  Save,
  Settings,
  Store,
  Trash2,
  Link as LinkIcon,
  TrendingUp,
} from "lucide-react";
import { MarketingSpendForm } from "@/components/owner/MarketingSpendForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { DomainsManager } from "@/components/owner/DomainsManager";
import { PaymentsSettingsForm } from "@/components/owner/PaymentsSettingsForm";
import { RegionSelector } from "@/components/owner/RegionSelector";
import {
  DEFAULT_GEO_TARGETS,
  parseGeoTargets,
  summarizeGeo,
  type GeoTargets,
} from "@/lib/acos/geoTargets";

export const Route = createFileRoute("/_authenticated/brand/settings")({
  validateSearch: (s: Record<string, unknown>): { tenant?: string } => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: StoreSettingsPage,
});

type Json = Record<string, unknown>;

type TenantConfigRow = {
  tenant_id: string;
  brand_name: string | null;
  ui: Json | null;
  seo: Json | null;
  bot: Json | null;
  geo_targets: Json | null;
};

type StoreForm = {
  brand_name: string;
  primary_color: string;
  accent_color: string;
  logo_url: string;
  hero_headline: string;
  hero_subline: string;
  hero_badge: string;
  hero_cta_text: string;
  hero_image: string;
  announcement: string;
  announcement_bg: string;
  about_text: string;
  faq_items: Array<{ question: string; answer: string }>;
  seo_title: string;
  seo_description: string;
  og_image_url: string;
  bot_welcome: string;
  bot_system: string;
  geo_targets: GeoTargets;
};

const DEFAULTS: StoreForm = {
  brand_name: "",
  primary_color: "#5b8cff",
  accent_color: "#a855f7",
  logo_url: "",
  hero_headline: "",
  hero_subline: "",
  hero_badge: "",
  hero_cta_text: "",
  hero_image: "",
  announcement: "",
  announcement_bg: "bg-primary",
  about_text: "",
  faq_items: [],
  seo_title: "",
  seo_description: "",
  og_image_url: "",
  bot_welcome: "Привіт! Як можу допомогти з покупкою?",
  bot_system: "",
  geo_targets: DEFAULT_GEO_TARGETS,
};

/** Готові пресети тла для смуги-оголошення (Tailwind utility-класи). */
const ANNOUNCEMENT_BG_PRESETS: Array<{ value: string; label: string }> = [
  { value: "bg-primary", label: "Основний" },
  { value: "bg-accent", label: "Акцент" },
  { value: "bg-destructive", label: "Розпродаж" },
  { value: "bg-foreground", label: "Контраст" },
];

function pickStr(o: Json | null, k: string, fallback = ""): string {
  if (!o) return fallback;
  const v = o[k];
  return typeof v === "string" ? v : fallback;
}

function parseFaqItems(o: Json | null): Array<{ question: string; answer: string }> {
  const raw = o?.faq_items;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (it): it is { question: string; answer: string } =>
        !!it &&
        typeof (it as { question?: unknown }).question === "string" &&
        typeof (it as { answer?: unknown }).answer === "string",
    )
    .map((it) => ({ question: it.question, answer: it.answer }));
}

function StoreSettingsPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/settings" });
  const { current, currentTenantId, setCurrentTenantId, tenants } = useTenantContext();
  const tenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;
  const qc = useQueryClient();
  const [form, setForm] = useState<StoreForm>(DEFAULTS);

  const cfgQuery = useQuery({
    queryKey: ["tenant-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_configs")
        .select("tenant_id, brand_name, ui, seo, bot, geo_targets")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TenantConfigRow | null;
    },
  });

  useEffect(() => {
    if (tenantId && urlTenant !== tenantId) {
      setCurrentTenantId(tenantId);
    }
  }, [tenantId, urlTenant, setCurrentTenantId]);

  useEffect(() => {
    const r = cfgQuery.data;
    if (!r) {
      setForm({ ...DEFAULTS, brand_name: current?.tenant_name ?? "" });
      return;
    }
    setForm({
      brand_name: r.brand_name ?? current?.tenant_name ?? "",
      primary_color: pickStr(r.ui, "primary_color", DEFAULTS.primary_color),
      accent_color: pickStr(r.ui, "accent_color", DEFAULTS.accent_color),
      logo_url: pickStr(r.ui, "logo_url", ""),
      hero_headline: pickStr(r.ui, "hero_headline", ""),
      hero_subline: pickStr(r.ui, "hero_subline", ""),
      hero_badge: pickStr(r.ui, "hero_badge", ""),
      hero_cta_text: pickStr(r.ui, "hero_cta_text", ""),
      hero_image: pickStr(r.ui, "hero_image", ""),
      announcement: pickStr(r.ui, "announcement", ""),
      announcement_bg: pickStr(r.ui, "announcement_bg", DEFAULTS.announcement_bg),
      about_text: pickStr(r.ui, "about_text", ""),
      faq_items: parseFaqItems(r.ui),
      seo_title: pickStr(r.seo, "title", ""),
      seo_description: pickStr(r.seo, "description", ""),
      og_image_url: pickStr(r.seo, "og_image_url", ""),
      bot_welcome: pickStr(r.bot, "welcome_message", DEFAULTS.bot_welcome),
      bot_system: pickStr(r.bot, "system_prompt", ""),
      geo_targets: parseGeoTargets(r.geo_targets) ?? DEFAULT_GEO_TARGETS,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgQuery.data?.tenant_id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Бренд не обрано");
      // зберігаємо ui/seo/bot, не перезаписуючи інші ключі
      const merged = {
        tenant_id: tenantId,
        brand_name: (form.brand_name.trim() || current?.tenant_name) ?? "Бренд",
        ui: {
          ...((cfgQuery.data?.ui as Json) ?? {}),
          primary_color: form.primary_color,
          accent_color: form.accent_color,
          logo_url: form.logo_url.trim(),
          hero_headline: form.hero_headline.trim(),
          hero_subline: form.hero_subline.trim(),
          hero_badge: form.hero_badge.trim(),
          hero_cta_text: form.hero_cta_text.trim(),
          hero_image: form.hero_image.trim(),
          announcement: form.announcement.trim(),
          announcement_bg: form.announcement_bg,
          about_text: form.about_text.trim(),
          faq_items: form.faq_items
            .map((it) => ({ question: it.question.trim(), answer: it.answer.trim() }))
            .filter((it) => it.question.length > 0),
        } as Json,
        seo: {
          ...((cfgQuery.data?.seo as Json) ?? {}),
          title: form.seo_title.trim(),
          description: form.seo_description.trim(),
          og_image_url: form.og_image_url.trim(),
        } as Json,
        bot: {
          ...((cfgQuery.data?.bot as Json) ?? {}),
          welcome_message: form.bot_welcome.trim(),
          system_prompt: form.bot_system.trim(),
        } as Json,
        geo_targets: form.geo_targets as unknown as Json,
      };
      const { error } = await supabase
        .from("tenant_configs")
        .upsert(merged as never, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Налаштування магазину збережено");
      qc.invalidateQueries({ queryKey: ["tenant-config", tenantId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Не вдалося зберегти"),
  });

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Спочатку оберіть бренд</CardTitle>
          <CardDescription>
            Використайте перемикач у верхній панелі, щоб обрати бренд для редагування.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Settings className="h-5 w-5 text-primary-foreground" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Налаштування магазину
            </h1>
            <p className="text-sm text-muted-foreground">
              Бренд, кольори, SEO та поведінка бота — все, що бачать ваші покупці.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {current && (
            <Badge variant="outline" className="font-mono text-[10px]">
              /{current.tenant_slug}
            </Badge>
          )}
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || cfgQuery.isLoading}
          >
            {saveMut.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Зберегти все
          </Button>
        </div>
      </div>

      {cfgQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Завантажую конфігурацію…</p>
      ) : (
        <Tabs defaultValue="general">
          <TabsList className="flex w-full max-w-3xl flex-wrap">
            <TabsTrigger value="general" className="gap-1.5">
              <Store className="h-3.5 w-3.5" /> Бренд
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-1.5">
              <Palette className="h-3.5 w-3.5" /> Зовнішній вигляд
            </TabsTrigger>
            <TabsTrigger value="storefront" className="gap-1.5">
              <LayoutTemplate className="h-3.5 w-3.5" /> Вітрина
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Оплата
            </TabsTrigger>
            <TabsTrigger value="seo" className="gap-1.5">
              <Globe className="h-3.5 w-3.5" /> SEO
            </TabsTrigger>
            <TabsTrigger value="region" className="gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Регіон
            </TabsTrigger>
            <TabsTrigger value="bot" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" /> Бот-консультант
            </TabsTrigger>
            <TabsTrigger value="marketing" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Маркетинг
            </TabsTrigger>
            <TabsTrigger value="domain" className="gap-1.5">
              <LinkIcon className="h-3.5 w-3.5" /> Домен
            </TabsTrigger>
          </TabsList>

          {/* GENERAL */}
          <TabsContent value="general" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary" /> Дані бренду
                </CardTitle>
                <CardDescription>
                  Назва, що відображається у вітрині, листах та вікні бота.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="brand-name">Назва бренду</Label>
                  <Input
                    id="brand-name"
                    value={form.brand_name}
                    onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
                    placeholder="Напр., Basic Food"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="logo">URL логотипу</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="logo"
                      value={form.logo_url}
                      onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
                      placeholder="https://…/logo.png"
                    />
                    {form.logo_url && (
                      <img
                        src={form.logo_url}
                        alt="logo preview"
                        loading="lazy"
                        decoding="async"
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-md border border-border object-contain bg-card"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Прозорий PNG/SVG, рекомендовано 256×256.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* APPEARANCE */}
          <TabsContent value="appearance" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-accent" /> Кольори магазину
                </CardTitle>
                <CardDescription>
                  Використовуються у вітрині та згенерованих сайтах.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ColorField
                  label="Основний колір"
                  value={form.primary_color}
                  onChange={(v) => setForm((f) => ({ ...f, primary_color: v }))}
                />
                <ColorField
                  label="Акцентний колір"
                  value={form.accent_color}
                  onChange={(v) => setForm((f) => ({ ...f, accent_color: v }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ImageIcon className="h-4 w-4 text-info" /> Попередній перегляд
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="rounded-lg border border-border p-6"
                  style={{
                    background: `linear-gradient(135deg, ${form.primary_color}22, ${form.accent_color}22)`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-10 w-10 rounded-lg shadow-md"
                      style={{ background: form.primary_color }}
                    />
                    <span
                      className="h-10 w-10 rounded-lg shadow-md"
                      style={{ background: form.accent_color }}
                    />
                    <div className="ml-4">
                      <p className="text-base font-semibold text-foreground">
                        {form.brand_name || "Ваш бренд"}
                      </p>
                      <p className="text-xs text-muted-foreground">Так виглядатиме у вітрині</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* STOREFRONT — hero + announcement */}
          <TabsContent value="storefront" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-primary" /> Головний банер (hero)
                </CardTitle>
                <CardDescription>
                  Перше, що бачить покупець на головній сторінці вітрини. Залиште порожнім —
                  показуватиметься назва бренду за замовчуванням.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="hero-badge">Бейдж (необов'язково)</Label>
                  <Input
                    id="hero-badge"
                    value={form.hero_badge}
                    onChange={(e) => setForm((f) => ({ ...f, hero_badge: e.target.value }))}
                    placeholder="Напр., Новинка · Безкоштовна доставка"
                    maxLength={40}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hero-headline">Заголовок</Label>
                  <Input
                    id="hero-headline"
                    value={form.hero_headline}
                    onChange={(e) => setForm((f) => ({ ...f, hero_headline: e.target.value }))}
                    placeholder="Напр., Свіжа кава з обсмажуванням на замовлення"
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hero-subline">Підзаголовок</Label>
                  <Textarea
                    id="hero-subline"
                    value={form.hero_subline}
                    onChange={(e) => setForm((f) => ({ ...f, hero_subline: e.target.value }))}
                    placeholder="Короткий опис цінності для покупця…"
                    maxLength={200}
                    className="min-h-20"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="hero-cta">Текст кнопки</Label>
                    <Input
                      id="hero-cta"
                      value={form.hero_cta_text}
                      onChange={(e) => setForm((f) => ({ ...f, hero_cta_text: e.target.value }))}
                      placeholder="Переглянути каталог"
                      maxLength={40}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hero-image">URL зображення</Label>
                    <Input
                      id="hero-image"
                      value={form.hero_image}
                      onChange={(e) => setForm((f) => ({ ...f, hero_image: e.target.value }))}
                      placeholder="https://…/hero.jpg"
                    />
                  </div>
                </div>
                {form.hero_image && (
                  <img
                    src={form.hero_image}
                    alt="hero preview"
                    loading="lazy"
                    decoding="async"
                    className="max-h-40 rounded-md border border-border bg-card object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-accent" /> Смуга-оголошення
                </CardTitle>
                <CardDescription>
                  Тонка смуга вгорі вітрини — для акцій, умов доставки чи новин. Порожнє поле —
                  смуга прихована.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="announcement">Текст оголошення</Label>
                  <Input
                    id="announcement"
                    value={form.announcement}
                    onChange={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))}
                    placeholder="Напр., 🚚 Безкоштовна доставка від 1000 ₴"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Тло смуги</Label>
                  <div className="flex flex-wrap gap-2">
                    {ANNOUNCEMENT_BG_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, announcement_bg: preset.value }))}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                          form.announcement_bg === preset.value
                            ? "border-primary ring-2 ring-primary/40"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                {form.announcement && (
                  <div
                    className={`flex items-center justify-center rounded-md px-4 py-2 text-center text-xs font-medium text-primary-foreground ${form.announcement_bg}`}
                  >
                    {form.announcement}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> Сторінка «Про магазин»
                </CardTitle>
                <CardDescription>
                  Текст для сторінки /about вашої вітрини. Звичайний текст; переноси рядків
                  зберігаються. Порожнє поле — сторінка показує заглушку.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={form.about_text}
                  onChange={(e) => setForm((f) => ({ ...f, about_text: e.target.value }))}
                  placeholder="Розкажіть історію бренду, цінності, чим ви відрізняєтесь…"
                  className="min-h-48"
                  maxLength={5000}
                />
                <p className="mt-1 text-xs text-muted-foreground">{form.about_text.length}/5000</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-accent" /> Часті питання (FAQ)
                </CardTitle>
                <CardDescription>
                  Питання та відповіді для сторінки /faq. Порожні питання не зберігаються.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {form.faq_items.map((item, idx) => (
                  <div key={idx} className="space-y-2 rounded-lg border border-border/60 p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={item.question}
                        onChange={(e) =>
                          setForm((f) => {
                            const next = [...f.faq_items];
                            next[idx] = { ...next[idx], question: e.target.value };
                            return { ...f, faq_items: next };
                          })
                        }
                        placeholder="Питання…"
                        className="text-sm font-medium"
                        maxLength={160}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            faq_items: f.faq_items.filter((_, i) => i !== idx),
                          }))
                        }
                        aria-label="Видалити питання"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <Textarea
                      value={item.answer}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = [...f.faq_items];
                          next[idx] = { ...next[idx], answer: e.target.value };
                          return { ...f, faq_items: next };
                        })
                      }
                      placeholder="Відповідь…"
                      className="min-h-16 text-sm"
                      maxLength={1000}
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      faq_items: [...f.faq_items, { question: "", answer: "" }],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Додати питання
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PAYMENTS */}
          <TabsContent value="payments" className="mt-4 space-y-4">
            <PaymentsSettingsForm tenantId={tenantId} />
          </TabsContent>

          {/* SEO */}
          <TabsContent value="seo" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-success" /> SEO та соцмережі
                </CardTitle>
                <CardDescription>Меташки для Google та превʼю в месенджерах.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="seo-title">Title (до 60 символів)</Label>
                  <Input
                    id="seo-title"
                    value={form.seo_title}
                    onChange={(e) => setForm((f) => ({ ...f, seo_title: e.target.value }))}
                    placeholder="Напр., Basic Food — здорова їжа з доставкою"
                    maxLength={70}
                  />
                  <p className="text-xs text-muted-foreground">{form.seo_title.length}/60</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seo-desc">Description (до 160 символів)</Label>
                  <Textarea
                    id="seo-desc"
                    value={form.seo_description}
                    onChange={(e) => setForm((f) => ({ ...f, seo_description: e.target.value }))}
                    placeholder="Короткий опис для пошуку…"
                    maxLength={200}
                    className="min-h-24"
                  />
                  <p className="text-xs text-muted-foreground">{form.seo_description.length}/160</p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="og">Open Graph image URL</Label>
                  <Input
                    id="og"
                    value={form.og_image_url}
                    onChange={(e) => setForm((f) => ({ ...f, og_image_url: e.target.value }))}
                    placeholder="https://…/cover.jpg (1200×630)"
                  />
                  {form.og_image_url && (
                    <img
                      src={form.og_image_url}
                      alt="OG preview"
                      loading="lazy"
                      decoding="async"
                      className="mt-2 max-h-40 rounded-md border border-border bg-card object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* REGION */}
          <TabsContent value="region" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" /> Регіон бренду
                </CardTitle>
                <CardDescription>
                  Країна та міста, з якими працюють агенти ціноутворення та акцій (price-optimizer,
                  geo-demand, predictive-pricing, promo-portfolio тощо). Кожен агент може мати
                  власний override у розділі «Агенти».
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Поточний фокус:{" "}
                  <span className="font-semibold text-foreground">
                    {summarizeGeo(form.geo_targets)}
                  </span>
                </div>
                <RegionSelector
                  value={form.geo_targets}
                  onChange={(g) => setForm((f) => ({ ...f, geo_targets: g }))}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* BOT */}
          <TabsContent value="bot" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-accent" /> Бот-консультант
                </CardTitle>
                <CardDescription>
                  Фрази, з якими бот зустрічає покупців і його роль у діалозі.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="welcome">Привітальне повідомлення</Label>
                  <Textarea
                    id="welcome"
                    value={form.bot_welcome}
                    onChange={(e) => setForm((f) => ({ ...f, bot_welcome: e.target.value }))}
                    className="min-h-20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sys">Системний промпт (роль)</Label>
                  <Textarea
                    id="sys"
                    value={form.bot_system}
                    onChange={(e) => setForm((f) => ({ ...f, bot_system: e.target.value }))}
                    placeholder="Ти ввічливий консультант магазину …"
                    className="min-h-32"
                  />
                  <p className="text-xs text-muted-foreground">
                    Опис ролі і тону. Чим конкретніше — тим краще працює бот.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DOMAIN */}
          <TabsContent value="marketing" className="mt-4 space-y-4">
            <MarketingSpendForm tenantId={tenantId} />
          </TabsContent>

          <TabsContent value="domain" className="mt-4 space-y-4">
            <DomainsManager tenantId={tenantId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="font-mono"
        />
      </div>
    </div>
  );
}
