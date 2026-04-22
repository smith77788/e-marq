import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { MSG } from "@/lib/glossary";

export type TenantConfigValues = {
  brand_name: string;
  ui: {
    primary_color: string;
    accent_color: string;
    logo_url: string;
    theme: "light" | "dark" | "system";
  };
  features: {
    bot_enabled: boolean;
    reorder_enabled: boolean;
    analytics_enabled: boolean;
  };
  bot: {
    system_prompt: string;
    welcome_message: string;
    model: string;
  };
  seo: {
    title: string;
    description: string;
    og_image_url: string;
  };
  payments: {
    manual_enabled: boolean;
    stripe_enabled: boolean;
    manual_instructions: string;
    manual_contact: string;
    currency: string;
    liqpay_enabled: boolean;
    liqpay_public_key: string;
    liqpay_private_key: string;
    wayforpay_enabled: boolean;
    wayforpay_merchant_account: string;
    wayforpay_secret_key: string;
    wayforpay_merchant_domain: string;
    monobank_enabled: boolean;
    monobank_token: string;
  };
};

type AnyRecord = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === "boolean" ? v : fallback;
const obj = (v: unknown): AnyRecord =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRecord) : {};

const DEFAULT_MANUAL_INSTRUCTIONS =
  "Оплата на картку: 0000 0000 0000 0000 (отримувач: ваш бренд). У призначенні платежу вкажіть номер замовлення.";

export function normalizeConfig(input: {
  brand_name?: string | null;
  ui?: unknown;
  features?: unknown;
  bot?: unknown;
  seo?: unknown;
}): TenantConfigValues {
  const ui = obj(input.ui);
  const features = obj(input.features);
  const bot = obj(input.bot);
  const seo = obj(input.seo);
  const payments = obj((features as AnyRecord).payments ?? (input as AnyRecord & { payments?: unknown }).payments);
  const theme = str(ui.theme, "system");
  return {
    brand_name: str(input.brand_name, ""),
    ui: {
      primary_color: str(ui.primary_color, "#6366f1"),
      accent_color: str(ui.accent_color, "#22d3ee"),
      logo_url: str(ui.logo_url, ""),
      theme: theme === "light" || theme === "dark" ? theme : "system",
    },
    features: {
      bot_enabled: bool(features.bot_enabled, false),
      reorder_enabled: bool(features.reorder_enabled, true),
      analytics_enabled: bool(features.analytics_enabled, true),
    },
    bot: {
      system_prompt: str(bot.system_prompt, ""),
      welcome_message: str(bot.welcome_message, ""),
      model: str(bot.model, "google/gemini-2.5-flash"),
    },
    seo: {
      title: str(seo.title, ""),
      description: str(seo.description, ""),
      og_image_url: str(seo.og_image_url, ""),
    },
    payments: {
      manual_enabled: bool(payments.manual_enabled, true),
      stripe_enabled: bool(payments.stripe_enabled, false),
      manual_instructions: str(payments.manual_instructions, DEFAULT_MANUAL_INSTRUCTIONS),
      manual_contact: str(payments.manual_contact, ""),
      currency: str(payments.currency, "UAH"),
      liqpay_enabled: bool(payments.liqpay_enabled, false),
      liqpay_public_key: str(payments.liqpay_public_key, ""),
      liqpay_private_key: str(payments.liqpay_private_key, ""),
      wayforpay_enabled: bool(payments.wayforpay_enabled, false),
      wayforpay_merchant_account: str(payments.wayforpay_merchant_account, ""),
      wayforpay_secret_key: str(payments.wayforpay_secret_key, ""),
      wayforpay_merchant_domain: str(payments.wayforpay_merchant_domain, ""),
      monobank_enabled: bool(payments.monobank_enabled, false),
      monobank_token: str(payments.monobank_token, ""),
    },
  };
}

type Props = {
  initialValues: TenantConfigValues;
  onSubmit: (values: TenantConfigValues) => void;
  isPending?: boolean;
};

const MAX_WELCOME = 200;
const MAX_PROMPT = 2000;

export function TenantConfigForm({ initialValues, onSubmit, isPending }: Props) {
  const [values, setValues] = useState<TenantConfigValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(initialValues);
    setErrors({});
  }, [initialValues]);

  const update = <K extends keyof TenantConfigValues>(
    key: K,
    patch: Partial<TenantConfigValues[K]> | TenantConfigValues[K],
  ) => {
    setValues((prev) => {
      const current = prev[key];
      if (typeof current === "object" && current !== null) {
        return { ...prev, [key]: { ...current, ...(patch as object) } };
      }
      return { ...prev, [key]: patch as TenantConfigValues[K] };
    });
  };

  const validate = (v: TenantConfigValues): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!v.brand_name.trim()) errs.brand_name = "Вкажіть назву бренду";
    if (v.payments.manual_enabled && !v.payments.manual_instructions.trim()) {
      errs.manual_instructions =
        "Опишіть, як саме клієнт має оплатити (картка, IBAN, телефон тощо)";
    }
    if (v.payments.currency.length !== 3) {
      errs.currency = "Код валюти має бути з 3 літер (наприклад UAH)";
    }
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Бренд */}
      <section className="space-y-3">
        <SectionHeader
          title="Бренд"
          description="Публічна назва, яку бачать ваші клієнти на вітрині магазину."
        />
        <div className="grid gap-2">
          <Label htmlFor="brand_name">Назва бренду *</Label>
          <Input
            id="brand_name"
            value={values.brand_name}
            onChange={(e) => setValues((p) => ({ ...p, brand_name: e.target.value }))}
            placeholder="Наприклад: Сонячна Пекарня"
            required
          />
          {errors.brand_name && (
            <p className="text-xs text-destructive">{errors.brand_name}</p>
          )}
        </div>
      </section>

      <Separator />

      {/* Зовнішній вигляд */}
      <section className="space-y-3">
        <SectionHeader
          title="Зовнішній вигляд"
          description="Кольори і логотип, які побачить клієнт у вашому магазині."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="primary_color">Основний колір</Label>
            <Input
              id="primary_color"
              value={values.ui.primary_color}
              onChange={(e) => update("ui", { primary_color: e.target.value })}
              placeholder="#6366f1"
            />
            <p className="text-[11px] text-muted-foreground">
              Колір кнопок та активних елементів. Скопіюйте з вашого фірмового стилю.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="accent_color">Додатковий колір</Label>
            <Input
              id="accent_color"
              value={values.ui.accent_color}
              onChange={(e) => update("ui", { accent_color: e.target.value })}
              placeholder="#22d3ee"
            />
            <p className="text-[11px] text-muted-foreground">
              Використовується для виділень і підказок.
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="logo_url">Посилання на логотип</Label>
          <Input
            id="logo_url"
            value={values.ui.logo_url}
            onChange={(e) => update("ui", { logo_url: e.target.value })}
            placeholder="https://приклад.ua/logo.png"
          />
          <p className="text-[11px] text-muted-foreground">
            Завантажте логотип будь-куди в інтернеті і вставте посилання сюди.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="theme">Оформлення</Label>
          <select
            id="theme"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={values.ui.theme}
            onChange={(e) =>
              update("ui", { theme: e.target.value as TenantConfigValues["ui"]["theme"] })
            }
          >
            <option value="system">Як у пристрої клієнта</option>
            <option value="light">Світле</option>
            <option value="dark">Темне</option>
          </select>
        </div>
      </section>

      <Separator />

      {/* Можливості */}
      <section className="space-y-3">
        <SectionHeader
          title="Можливості"
          description="Увімкніть або вимкніть функції магазину."
        />
        <FeatureToggle
          label="ШІ-помічник у магазині"
          description="Маленький чат у вітрині, який відповідає клієнтам і радить товари."
          checked={values.features.bot_enabled}
          onChange={(v) => update("features", { bot_enabled: v })}
        />
        <FeatureToggle
          label="Замовлення в один клік"
          description="Постійні клієнти зможуть повторити минуле замовлення однією кнопкою."
          checked={values.features.reorder_enabled}
          onChange={(v) => update("features", { reorder_enabled: v })}
        />
        <FeatureToggle
          label="Збір аналітики"
          description="Записувати, які сторінки переглядають клієнти, що додають у кошик і купують."
          checked={values.features.analytics_enabled}
          onChange={(v) => update("features", { analytics_enabled: v })}
        />
      </section>

      <Separator />

      {/* ШІ-помічник */}
      <section className="space-y-3">
        <SectionHeader
          title="ШІ-помічник у магазині"
          description="Налаштуйте, як саме помічник спілкується з клієнтами."
        />
        <div className="grid gap-2">
          <Label htmlFor="bot_model">Який ШІ-двигун використовувати</Label>
          <select
            id="bot_model"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={values.bot.model}
            onChange={(e) => update("bot", { model: e.target.value })}
          >
            <option value="google/gemini-2.5-flash">Швидкий і дешевий (Gemini Flash)</option>
            <option value="google/gemini-2.5-pro">Розумний (Gemini Pro)</option>
            <option value="openai/gpt-5-mini">Збалансований (GPT-5 Mini)</option>
            <option value="openai/gpt-5">Найрозумніший (GPT-5)</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            Швидкий — для коротких відповідей. Розумний — коли клієнти ставлять складні питання.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="welcome_message">Привітання</Label>
          <Input
            id="welcome_message"
            value={values.bot.welcome_message}
            onChange={(e) =>
              update("bot", { welcome_message: e.target.value.slice(0, MAX_WELCOME) })
            }
            placeholder="Вітаю! Я допоможу обрати товар. Що шукаєте?"
            maxLength={MAX_WELCOME}
          />
          <p className="text-[11px] text-muted-foreground">
            Перше повідомлення, яке побачить клієнт у чаті. {values.bot.welcome_message.length}/{MAX_WELCOME}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="system_prompt">Інструкція для помічника</Label>
          <Textarea
            id="system_prompt"
            value={values.bot.system_prompt}
            onChange={(e) =>
              update("bot", { system_prompt: e.target.value.slice(0, MAX_PROMPT) })
            }
            placeholder="Ти — приязний консультант магазину {brand}. Завжди радь товари з нашого каталогу. Відповідай українською, коротко і по суті."
            rows={5}
            maxLength={MAX_PROMPT}
          />
          <p className="text-[11px] text-muted-foreground">
            Опишіть характер помічника простими словами: який тон, що пропонувати, чого уникати.
            {" "}{values.bot.system_prompt.length}/{MAX_PROMPT}
          </p>
        </div>
      </section>

      <Separator />

      {/* Як магазин виглядає в Google */}
      <section className="space-y-3">
        <SectionHeader
          title="Як магазин виглядає в Google"
          description="Текст і картинка, які побачать люди в результатах пошуку та коли діляться посиланням."
        />
        <div className="grid gap-2">
          <Label htmlFor="seo_title">Заголовок у Google</Label>
          <Input
            id="seo_title"
            value={values.seo.title}
            onChange={(e) => update("seo", { title: e.target.value })}
            maxLength={60}
            placeholder="Сонячна Пекарня — свіжа випічка щодня"
          />
          <p className="text-xs text-muted-foreground">{values.seo.title.length}/60</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seo_description">Опис у Google</Label>
          <Textarea
            id="seo_description"
            value={values.seo.description}
            onChange={(e) => update("seo", { description: e.target.value })}
            maxLength={160}
            rows={3}
            placeholder="Хліб, круасани і торти з натуральних інгредієнтів. Доставка по Львову за 2 години."
          />
          <p className="text-xs text-muted-foreground">{values.seo.description.length}/160</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="og_image_url">Картинка для соцмереж</Label>
          <Input
            id="og_image_url"
            value={values.seo.og_image_url}
            onChange={(e) => update("seo", { og_image_url: e.target.value })}
            placeholder="https://приклад.ua/cover.jpg"
          />
          <p className="text-[11px] text-muted-foreground">
            Що покаже Facebook чи Telegram, коли хтось поділиться посиланням на ваш магазин.
            Розмір 1200×630.
          </p>
        </div>
      </section>

      <Separator />

      {/* Оплата */}
      <section className="space-y-3">
        <SectionHeader
          title="Оплата"
          description="Як саме клієнт буде платити за замовлення."
        />
        <div className="grid gap-2">
          <Label htmlFor="payments_currency">Валюта (3 літери)</Label>
          <Input
            id="payments_currency"
            value={values.payments.currency}
            onChange={(e) =>
              update("payments", { currency: e.target.value.toUpperCase().slice(0, 3) })
            }
            placeholder="UAH"
            maxLength={3}
          />
          {errors.currency && (
            <p className="text-xs text-destructive">{errors.currency}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            UAH — гривня, USD — долар, EUR — євро.
          </p>
        </div>
        <FeatureToggle
          label="Оплата вручну (переказ на картку)"
          description="Клієнт оформлює замовлення, переказує гроші, ви підтверджуєте оплату."
          checked={values.payments.manual_enabled}
          onChange={(v) => update("payments", { manual_enabled: v })}
        />
        <FeatureToggle
          label="Оплата карткою через Stripe"
          description="Автоматична оплата картою. Потрібен ключ Stripe — додайте в налаштуваннях інтеграцій."
          checked={values.payments.stripe_enabled}
          onChange={(v) => update("payments", { stripe_enabled: v })}
        />
        {values.payments.manual_enabled && (
          <>
            <div className="grid gap-2">
              <Label htmlFor="manual_instructions">Інструкція з оплати *</Label>
              <Textarea
                id="manual_instructions"
                value={values.payments.manual_instructions}
                onChange={(e) =>
                  update("payments", { manual_instructions: e.target.value })
                }
                rows={5}
                placeholder={DEFAULT_MANUAL_INSTRUCTIONS}
              />
              {errors.manual_instructions && (
                <p className="text-xs text-destructive">{errors.manual_instructions}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Цей текст побачить клієнт після оформлення замовлення. Напишіть номер картки,
                IBAN або інший спосіб переказу.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual_contact">Куди писати щодо оплати</Label>
              <Input
                id="manual_contact"
                value={values.payments.manual_contact}
                onChange={(e) => update("payments", { manual_contact: e.target.value })}
                placeholder="oplata@приклад.ua або +380…"
              />
              <p className="text-[11px] text-muted-foreground">
                Email або телефон, куди клієнт може звернутись, якщо щось пішло не так.
              </p>
            </div>
          </>
        )}

        <Separator />

        {/* LiqPay */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">LiqPay (ПриватБанк)</p>
              <p className="text-xs text-muted-foreground">
                Картки Visa/Mastercard, Apple Pay, Google Pay. Ключі — у кабінеті LiqPay → API.
              </p>
            </div>
            <Switch
              checked={values.payments.liqpay_enabled}
              onCheckedChange={(v) => update("payments", { liqpay_enabled: v })}
            />
          </div>
          {values.payments.liqpay_enabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="liqpay_public_key">Public key</Label>
                <Input
                  id="liqpay_public_key"
                  value={values.payments.liqpay_public_key}
                  onChange={(e) =>
                    update("payments", { liqpay_public_key: e.target.value.trim() })
                  }
                  placeholder="i00000000000"
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="liqpay_private_key">Private key</Label>
                <Input
                  id="liqpay_private_key"
                  type="password"
                  value={values.payments.liqpay_private_key}
                  onChange={(e) =>
                    update("payments", { liqpay_private_key: e.target.value.trim() })
                  }
                  placeholder="••••••••"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Зберігається зашифровано та використовується лише на сервері.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* WayForPay */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">WayForPay</p>
              <p className="text-xs text-muted-foreground">
                Українські картки, Privat24, Apple/Google Pay. Дані — у кабінеті WayForPay → Налаштування.
              </p>
            </div>
            <Switch
              checked={values.payments.wayforpay_enabled}
              onCheckedChange={(v) => update("payments", { wayforpay_enabled: v })}
            />
          </div>
          {values.payments.wayforpay_enabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wfp_merchant_account">Merchant account</Label>
                <Input
                  id="wfp_merchant_account"
                  value={values.payments.wayforpay_merchant_account}
                  onChange={(e) =>
                    update("payments", { wayforpay_merchant_account: e.target.value.trim() })
                  }
                  placeholder="test_merch_n1"
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wfp_secret">Secret key</Label>
                <Input
                  id="wfp_secret"
                  type="password"
                  value={values.payments.wayforpay_secret_key}
                  onChange={(e) =>
                    update("payments", { wayforpay_secret_key: e.target.value.trim() })
                  }
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="wfp_domain">Merchant domain</Label>
                <Input
                  id="wfp_domain"
                  value={values.payments.wayforpay_merchant_domain}
                  onChange={(e) =>
                    update("payments", { wayforpay_merchant_domain: e.target.value.trim() })
                  }
                  placeholder="shop.приклад.ua"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Домен має точно збігатись з тим, що ви ввели в кабінеті WayForPay.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Monobank */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Monobank Acquiring</p>
              <p className="text-xs text-muted-foreground">
                Прийом оплат через Monobank. Токен — у кабінеті Monobank Acquiring → API.
              </p>
            </div>
            <Switch
              checked={values.payments.monobank_enabled}
              onCheckedChange={(v) => update("payments", { monobank_enabled: v })}
            />
          </div>
          {values.payments.monobank_enabled && (
            <div className="grid gap-1.5">
              <Label htmlFor="mono_token">X-Token</Label>
              <Input
                id="mono_token"
                type="password"
                value={values.payments.monobank_token}
                onChange={(e) =>
                  update("payments", { monobank_token: e.target.value.trim() })
                }
                placeholder="••••••••"
                autoComplete="off"
              />
            </div>
          )}
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? MSG.saving : "Зберегти зміни"}
        </Button>
      </div>
    </form>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function FeatureToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
