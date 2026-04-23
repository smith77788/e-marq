/**
 * Site Builder → Niche Wizard (Sprint 11.7).
 *
 * 8 clarifying questions that shape the generated archive:
 *   1. Business type
 *   2. Target audience
 *   3. Products/services overview
 *   4. USP
 *   5. Tone of voice (single select)
 *   6. Must-have features (multi-select from MFD module library)
 *   7. Competitor URLs (up to 3)
 *   8. Growth goal (single select)
 *
 * Stored in `site_brand_profiles.niche_profile` (jsonb). Drives the niche-
 * tailored seed.json + LOVABLE_REMIX_PROMPT.md + PAGES_INVENTORY.md inside
 * the generated ZIP.
 *
 * UX: a single Card with grouped sections, plain controls (no third-party
 * wizard library) and a small preview of how the answers will be used.
 */
import { useMemo } from "react";
import { Sparkles, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export type NicheDraft = {
  business_type: string;
  target_audience: string;
  products_overview: string;
  usp: string;
  tone_of_voice: string;
  must_have_features: string[];
  competitor_urls: string[];
  growth_goal: string;
};

export const EMPTY_NICHE: NicheDraft = {
  business_type: "",
  target_audience: "",
  products_overview: "",
  usp: "",
  tone_of_voice: "friendly",
  must_have_features: ["catalog", "blog", "reviews", "contacts", "faq"],
  competitor_urls: [],
  growth_goal: "first-100-orders",
};

const TONE_OPTIONS: Array<{ value: string; label: string; desc: string }> = [
  { value: "friendly", label: "Дружній", desc: "Тепло, на «ви», без офіціозу" },
  { value: "premium", label: "Преміальний", desc: "Стримано, дорого, лаконічно" },
  { value: "playful", label: "Грайливий", desc: "Емодзі, гумор, легкість" },
  { value: "expert", label: "Експертний", desc: "Цифри, факти, авторитет" },
  { value: "minimal", label: "Мінімал", desc: "Тільки суть, ніяких прикрас" },
];

const FEATURE_OPTIONS: Array<{ value: string; label: string; group: string }> = [
  { value: "catalog", label: "Каталог + товари", group: "Базове" },
  { value: "blog", label: "Блог", group: "Контент" },
  { value: "reviews", label: "Відгуки", group: "Базове" },
  { value: "faq", label: "FAQ", group: "Базове" },
  { value: "contacts", label: "Контакти + форма", group: "Базове" },
  { value: "promotions", label: "Акції / промо", group: "Маркетинг" },
  { value: "wishlist", label: "Список бажань", group: "Engagement" },
  { value: "loyalty", label: "Програма лояльності", group: "Маркетинг" },
  { value: "wholesale", label: "Опт + кабінет", group: "Розширення" },
  { value: "distributor-portal", label: "Дистриб'ютори", group: "Розширення" },
  { value: "spin-game", label: "Гра «Колесо удачі»", group: "Engagement" },
  { value: "newsletter", label: "Email-розсилка", group: "Маркетинг" },
  { value: "telegram-bot", label: "Telegram-бот замовлень", group: "Канали" },
  { value: "instagram-feed", label: "Instagram-стрічка", group: "Канали" },
  { value: "delivery", label: "Сторінка доставки", group: "Базове" },
  { value: "subscriptions", label: "Підписки на товари", group: "Розширення" },
  { value: "category-landings", label: "Лендінги категорій", group: "SEO" },
  { value: "programmatic-seo", label: "Програмні SEO-лендінги", group: "SEO" },
  { value: "referral", label: "Реферальна програма", group: "Маркетинг" },
];

const GOAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "first-100-orders", label: "Перші 100 замовлень" },
  { value: "scale-to-1k-mrr", label: "Стабільний MRR 1k+" },
  { value: "wholesale-network", label: "Оптова мережа партнерів" },
  { value: "international-expansion", label: "Міжнародна експансія" },
  { value: "brand-awareness", label: "Brand awareness" },
];

export function NicheWizard({
  draft,
  setDraft,
}: {
  draft: NicheDraft;
  setDraft: (next: NicheDraft) => void;
}) {
  const set = <K extends keyof NicheDraft>(key: K, value: NicheDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  const toggleFeature = (value: string) => {
    const current = new Set(draft.must_have_features);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    set("must_have_features", Array.from(current));
  };

  const featureGroups = useMemo(() => {
    const groups: Record<string, typeof FEATURE_OPTIONS> = {};
    for (const f of FEATURE_OPTIONS) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    }
    return groups;
  }, []);

  const competitorAt = (i: number) => draft.competitor_urls[i] ?? "";
  const setCompetitor = (i: number, value: string) => {
    const arr = [...draft.competitor_urls];
    arr[i] = value;
    set(
      "competitor_urls",
      arr.filter((x, idx) => x.trim() || idx < arr.length - 1),
    );
  };

  const completeness = useMemo(() => {
    let score = 0;
    if (draft.business_type.trim()) score++;
    if (draft.target_audience.trim()) score++;
    if (draft.products_overview.trim()) score++;
    if (draft.usp.trim()) score++;
    if (draft.must_have_features.length >= 3) score++;
    return { score, total: 5 };
  }, [draft]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Бриф для AI-генератора
            </CardTitle>
            <CardDescription className="max-w-2xl">
              Відповіді сформують hero-копію, категорії, FAQ, блог-теми, програмні
              SEO-лендінги та готовий промпт для Lovable у генерованому архіві.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              completeness.score === completeness.total
                ? "border-success/40 text-success"
                : "border-muted-foreground/30 text-muted-foreground"
            }
          >
            {completeness.score === completeness.total && (
              <Check className="mr-1 h-3 w-3" />
            )}
            {completeness.score}/{completeness.total} заповнено
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 1 + 2 */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs">
              1. Тип бізнесу <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Кав'ярня, бренд одягу, косметика…"
              value={draft.business_type}
              onChange={(e) => set("business_type", e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Один-два слова. Впливає на пресет категорій.
            </p>
          </div>
          <div>
            <Label className="mb-1 block text-xs">
              2. Цільова аудиторія <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Молоді мами, 25-40, Київ"
              value={draft.target_audience}
              onChange={(e) => set("target_audience", e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Кому продаєте? Один рядок.
            </p>
          </div>
        </div>

        {/* 3 */}
        <div>
          <Label className="mb-1 block text-xs">
            3. Що ви продаєте? <span className="text-destructive">*</span>
          </Label>
          <Textarea
            rows={3}
            placeholder="Наприклад: спешелті-кава, авторські десерти, мерч (футболки, чашки)…"
            value={draft.products_overview}
            onChange={(e) => set("products_overview", e.target.value)}
          />
        </div>

        {/* 4 */}
        <div>
          <Label className="mb-1 block text-xs">
            4. Унікальна торгова пропозиція (USP){" "}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            rows={2}
            placeholder="Чим ви кращі за конкурентів? Що НЕ можуть запропонувати інші?"
            value={draft.usp}
            onChange={(e) => set("usp", e.target.value)}
          />
        </div>

        <Separator />

        {/* 5. Tone */}
        <div>
          <Label className="mb-2 block text-xs">5. Тон комунікації</Label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {TONE_OPTIONS.map((t) => {
              const active = draft.tone_of_voice === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set("tone_of_voice", t.value)}
                  className={`rounded-md border p-3 text-left text-xs transition ${
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* 6. Features */}
        <div>
          <Label className="mb-2 block text-xs">
            6. Які фічі активувати? (мін. 3)
          </Label>
          <div className="space-y-3">
            {Object.entries(featureGroups).map(([group, items]) => (
              <div key={group}>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((f) => {
                    const active = draft.must_have_features.includes(f.value);
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => toggleFeature(f.value)}
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {active && <Check className="mr-1 inline h-3 w-3" />}
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* 7. Competitors */}
        <div>
          <Label className="mb-2 block text-xs">
            7. 1–3 сайти-бенчмарки (опційно, для тону)
          </Label>
          <div className="grid gap-2 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Input
                key={i}
                placeholder={`https://example${i + 1}.com`}
                value={competitorAt(i)}
                onChange={(e) => setCompetitor(i, e.target.value)}
              />
            ))}
          </div>
        </div>

        <Separator />

        {/* 8. Growth goal */}
        <div>
          <Label className="mb-2 block text-xs">8. Бізнес-ціль на найближчі 6 місяців</Label>
          <div className="flex flex-wrap gap-2">
            {GOAL_OPTIONS.map((g) => {
              const active = draft.growth_goal === g.value;
              return (
                <Button
                  key={g.value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => set("growth_goal", g.value)}
                >
                  {g.label}
                </Button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
