import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

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
  };
};

type AnyRecord = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === "boolean" ? v : fallback;
const obj = (v: unknown): AnyRecord =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRecord) : {};

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
      manual_instructions: str(
        payments.manual_instructions,
        "Bank transfer: IBAN UA00 0000 0000 0000 0000 0000 000\nReference your order ID in the payment description.",
      ),
      manual_contact: str(payments.manual_contact, ""),
      currency: str(payments.currency, "USD"),
    },
  };
}

type Props = {
  initialValues: TenantConfigValues;
  onSubmit: (values: TenantConfigValues) => void;
  isPending?: boolean;
};

export function TenantConfigForm({ initialValues, onSubmit, isPending }: Props) {
  const [values, setValues] = useState<TenantConfigValues>(initialValues);

  useEffect(() => {
    setValues(initialValues);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.brand_name.trim()) return;
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Brand */}
      <section className="space-y-3">
        <SectionHeader title="Brand" description="Public name displayed across the storefront." />
        <div className="grid gap-2">
          <Label htmlFor="brand_name">Brand name *</Label>
          <Input
            id="brand_name"
            value={values.brand_name}
            onChange={(e) => setValues((p) => ({ ...p, brand_name: e.target.value }))}
            required
          />
        </div>
      </section>

      <Separator />

      {/* UI */}
      <section className="space-y-3">
        <SectionHeader title="UI" description="Visual theming for the storefront." />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="primary_color">Primary color</Label>
            <Input
              id="primary_color"
              value={values.ui.primary_color}
              onChange={(e) => update("ui", { primary_color: e.target.value })}
              placeholder="#6366f1"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="accent_color">Accent color</Label>
            <Input
              id="accent_color"
              value={values.ui.accent_color}
              onChange={(e) => update("ui", { accent_color: e.target.value })}
              placeholder="#22d3ee"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="logo_url">Logo URL</Label>
          <Input
            id="logo_url"
            value={values.ui.logo_url}
            onChange={(e) => update("ui", { logo_url: e.target.value })}
            placeholder="https://…"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="theme">Theme</Label>
          <select
            id="theme"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={values.ui.theme}
            onChange={(e) =>
              update("ui", { theme: e.target.value as TenantConfigValues["ui"]["theme"] })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>

      <Separator />

      {/* Features */}
      <section className="space-y-3">
        <SectionHeader title="Features" description="Enable or disable storefront capabilities." />
        <FeatureToggle
          label="AI bot"
          description="Show the in-store AI assistant."
          checked={values.features.bot_enabled}
          onChange={(v) => update("features", { bot_enabled: v })}
        />
        <FeatureToggle
          label="One-click reorder"
          description="Allow returning customers to reorder past purchases."
          checked={values.features.reorder_enabled}
          onChange={(v) => update("features", { reorder_enabled: v })}
        />
        <FeatureToggle
          label="Analytics"
          description="Track funnel events for this tenant."
          checked={values.features.analytics_enabled}
          onChange={(v) => update("features", { analytics_enabled: v })}
        />
      </section>

      <Separator />

      {/* Bot */}
      <section className="space-y-3">
        <SectionHeader title="Bot" description="Configure the AI assistant behavior." />
        <div className="grid gap-2">
          <Label htmlFor="bot_model">Model</Label>
          <select
            id="bot_model"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={values.bot.model}
            onChange={(e) => update("bot", { model: e.target.value })}
          >
            <option value="google/gemini-2.5-flash">Gemini 2.5 Flash (fast, cheap)</option>
            <option value="google/gemini-2.5-pro">Gemini 2.5 Pro (powerful)</option>
            <option value="openai/gpt-5-mini">GPT-5 Mini (balanced)</option>
            <option value="openai/gpt-5">GPT-5 (top reasoning)</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="welcome_message">Welcome message</Label>
          <Input
            id="welcome_message"
            value={values.bot.welcome_message}
            onChange={(e) => update("bot", { welcome_message: e.target.value })}
            placeholder="Hi! How can I help?"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="system_prompt">System prompt</Label>
          <Textarea
            id="system_prompt"
            value={values.bot.system_prompt}
            onChange={(e) => update("bot", { system_prompt: e.target.value })}
            placeholder="You are a helpful assistant for {brand}. Always recommend products from the catalog…"
            rows={5}
          />
        </div>
      </section>

      <Separator />

      {/* SEO */}
      <section className="space-y-3">
        <SectionHeader title="SEO" description="Metadata for search engines and social sharing." />
        <div className="grid gap-2">
          <Label htmlFor="seo_title">Title</Label>
          <Input
            id="seo_title"
            value={values.seo.title}
            onChange={(e) => update("seo", { title: e.target.value })}
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground">{values.seo.title.length}/60</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seo_description">Description</Label>
          <Textarea
            id="seo_description"
            value={values.seo.description}
            onChange={(e) => update("seo", { description: e.target.value })}
            maxLength={160}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">{values.seo.description.length}/160</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="og_image_url">OG image URL</Label>
          <Input
            id="og_image_url"
            value={values.seo.og_image_url}
            onChange={(e) => update("seo", { og_image_url: e.target.value })}
            placeholder="https://…"
          />
        </div>
      </section>

      <Separator />

      {/* Payments */}
      <section className="space-y-3">
        <SectionHeader
          title="Payments"
          description="Configure how customers pay. Manual = bank transfer confirmed by you. Stripe = automatic card payment (requires API keys)."
        />
        <div className="grid gap-2">
          <Label htmlFor="payments_currency">Currency (ISO 4217)</Label>
          <Input
            id="payments_currency"
            value={values.payments.currency}
            onChange={(e) =>
              update("payments", { currency: e.target.value.toUpperCase().slice(0, 3) })
            }
            placeholder="USD"
            maxLength={3}
          />
        </div>
        <FeatureToggle
          label="Manual payment (bank transfer)"
          description="Customer places order, you confirm payment manually after receiving funds."
          checked={values.payments.manual_enabled}
          onChange={(v) => update("payments", { manual_enabled: v })}
        />
        <FeatureToggle
          label="Stripe card payment"
          description="Automatic card processing via Stripe. Requires STRIPE_SECRET_KEY (BYOK)."
          checked={values.payments.stripe_enabled}
          onChange={(v) => update("payments", { stripe_enabled: v })}
        />
        {values.payments.manual_enabled && (
          <>
            <div className="grid gap-2">
              <Label htmlFor="manual_instructions">Manual payment instructions</Label>
              <Textarea
                id="manual_instructions"
                value={values.payments.manual_instructions}
                onChange={(e) =>
                  update("payments", { manual_instructions: e.target.value })
                }
                rows={5}
                placeholder="Bank transfer: IBAN ..."
              />
              <p className="text-xs text-muted-foreground">
                Shown to customer after they place a manual order.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual_contact">Contact for payment questions</Label>
              <Input
                id="manual_contact"
                value={values.payments.manual_contact}
                onChange={(e) => update("payments", { manual_contact: e.target.value })}
                placeholder="payments@yourbrand.com or +380…"
              />
            </div>
          </>
        )}
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
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
