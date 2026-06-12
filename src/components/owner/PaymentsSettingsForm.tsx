/**
 * Owner-facing payment gateway settings.
 *
 * Reads via get_tenant_payment_settings (returns non-secret fields + has_*_saved
 * flags — the browser never receives stored secrets) and writes via
 * update_tenant_payment_settings (secret params NULL = keep existing, so a blank
 * field never wipes a saved key). Both RPCs require tenant_admin.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Loader2, Save, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";

type PaymentSettings = {
  currency: string;
  manual_enabled: boolean;
  manual_instructions: string;
  manual_contact: string;
  liqpay_enabled: boolean;
  liqpay_public_key: string;
  liqpay_secret_saved: boolean;
  wayforpay_enabled: boolean;
  wayforpay_merchant_account: string;
  wayforpay_merchant_domain: string;
  wayforpay_secret_saved: boolean;
  monobank_enabled: boolean;
  monobank_token_saved: boolean;
};

type FormState = {
  currency: string;
  manual_enabled: boolean;
  manual_instructions: string;
  manual_contact: string;
  liqpay_enabled: boolean;
  liqpay_public_key: string;
  liqpay_private_key: string; // new value only; empty = keep saved
  wayforpay_enabled: boolean;
  wayforpay_merchant_account: string;
  wayforpay_merchant_domain: string;
  wayforpay_secret_key: string; // new value only
  monobank_enabled: boolean;
  monobank_token: string; // new value only
};

const DEFAULT_MANUAL =
  "Оплата на картку: 0000 0000 0000 0000 (отримувач: ваш бренд). У призначенні вкажіть номер замовлення.";

function toForm(s: PaymentSettings): FormState {
  return {
    currency: s.currency || "UAH",
    manual_enabled: s.manual_enabled,
    manual_instructions: s.manual_instructions || "",
    manual_contact: s.manual_contact || "",
    liqpay_enabled: s.liqpay_enabled,
    liqpay_public_key: s.liqpay_public_key || "",
    liqpay_private_key: "",
    wayforpay_enabled: s.wayforpay_enabled,
    wayforpay_merchant_account: s.wayforpay_merchant_account || "",
    wayforpay_merchant_domain: s.wayforpay_merchant_domain || "",
    wayforpay_secret_key: "",
    monobank_enabled: s.monobank_enabled,
    monobank_token: "",
  };
}

export function PaymentsSettingsForm({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["payment-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_payment_settings", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return data as unknown as PaymentSettings;
    },
  });

  useEffect(() => {
    if (settingsQuery.data) setForm(toForm(settingsQuery.data));
  }, [settingsQuery.data]);

  const saved = settingsQuery.data;

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      if (f.currency.trim().length !== 3) throw new Error("Код валюти — 3 літери (UAH, USD…)");
      if (f.manual_enabled && !f.manual_instructions.trim()) {
        throw new Error("Опишіть, як клієнт має оплатити вручну");
      }
      const { error } = await supabase.rpc("update_tenant_payment_settings", {
        _tenant_id: tenantId,
        _currency: f.currency.trim().toUpperCase(),
        _manual_enabled: f.manual_enabled,
        _manual_instructions: f.manual_instructions.trim(),
        _manual_contact: f.manual_contact.trim(),
        _liqpay_enabled: f.liqpay_enabled,
        _liqpay_public_key: f.liqpay_public_key.trim(),
        _liqpay_private_key: f.liqpay_private_key.trim() || null,
        _wayforpay_enabled: f.wayforpay_enabled,
        _wayforpay_merchant_account: f.wayforpay_merchant_account.trim(),
        _wayforpay_merchant_domain: f.wayforpay_merchant_domain.trim(),
        _wayforpay_secret_key: f.wayforpay_secret_key.trim() || null,
        _monobank_enabled: f.monobank_enabled,
        _monobank_token: f.monobank_token.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Платіжні налаштування збережено");
      qc.invalidateQueries({ queryKey: ["payment-settings", tenantId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Не вдалося зберегти"),
  });

  if (settingsQuery.isLoading || !form) {
    return <p className="text-sm text-muted-foreground">Завантажую платіжні налаштування…</p>;
  }
  if (settingsQuery.isError) {
    return (
      <p className="text-sm text-destructive">
        Не вдалося завантажити налаштування оплати. Лише власник/адмін бренду має доступ.
      </p>
    );
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" /> Способи оплати
          </CardTitle>
          <CardDescription>
            Увімкніть платіжні шлюзи й введіть ключі з їхніх кабінетів. Секретні ключі зберігаються
            лише на сервері й ніколи не повертаються у браузер.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-40">
            <Label htmlFor="pay-currency">Валюта (3 літери)</Label>
            <Input
              id="pay-currency"
              value={form.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
              placeholder="UAH"
              maxLength={3}
            />
          </div>

          <Separator />

          {/* Manual */}
          <GatewayRow
            title="Оплата вручну (переказ на картку)"
            description="Клієнт оформлює замовлення, переказує гроші, ви підтверджуєте оплату."
            enabled={form.manual_enabled}
            onToggle={(v) => set("manual_enabled", v)}
          >
            <div className="grid gap-2">
              <Label htmlFor="manual-instr">Інструкція з оплати</Label>
              <Textarea
                id="manual-instr"
                value={form.manual_instructions}
                onChange={(e) => set("manual_instructions", e.target.value)}
                rows={4}
                placeholder={DEFAULT_MANUAL}
              />
              <p className="text-[11px] text-muted-foreground">
                Цей текст клієнт побачить після оформлення замовлення.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-contact">Куди писати щодо оплати</Label>
              <Input
                id="manual-contact"
                value={form.manual_contact}
                onChange={(e) => set("manual_contact", e.target.value)}
                placeholder="oplata@приклад.ua або +380…"
              />
            </div>
          </GatewayRow>

          {/* LiqPay */}
          <GatewayRow
            title="LiqPay (ПриватБанк)"
            description="Visa/Mastercard, Apple Pay, Google Pay. Ключі — у кабінеті LiqPay → API."
            enabled={form.liqpay_enabled}
            onToggle={(v) => set("liqpay_enabled", v)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="lp-pub">Public key</Label>
                <Input
                  id="lp-pub"
                  value={form.liqpay_public_key}
                  onChange={(e) => set("liqpay_public_key", e.target.value.trim())}
                  placeholder="i00000000000"
                  autoComplete="off"
                />
              </div>
              <SecretField
                id="lp-priv"
                label="Private key"
                saved={saved?.liqpay_secret_saved ?? false}
                value={form.liqpay_private_key}
                onChange={(v) => set("liqpay_private_key", v)}
              />
            </div>
          </GatewayRow>

          {/* WayForPay */}
          <GatewayRow
            title="WayForPay"
            description="Українські картки, Privat24, Apple/Google Pay. Дані — у кабінеті WayForPay."
            enabled={form.wayforpay_enabled}
            onToggle={(v) => set("wayforpay_enabled", v)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wfp-acc">Merchant account</Label>
                <Input
                  id="wfp-acc"
                  value={form.wayforpay_merchant_account}
                  onChange={(e) => set("wayforpay_merchant_account", e.target.value.trim())}
                  placeholder="test_merch_n1"
                  autoComplete="off"
                />
              </div>
              <SecretField
                id="wfp-secret"
                label="Secret key"
                saved={saved?.wayforpay_secret_saved ?? false}
                value={form.wayforpay_secret_key}
                onChange={(v) => set("wayforpay_secret_key", v)}
              />
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="wfp-domain">Merchant domain</Label>
                <Input
                  id="wfp-domain"
                  value={form.wayforpay_merchant_domain}
                  onChange={(e) => set("wayforpay_merchant_domain", e.target.value.trim())}
                  placeholder="shop.приклад.ua"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Має точно збігатись із доменом у кабінеті WayForPay.
                </p>
              </div>
            </div>
          </GatewayRow>

          {/* Monobank */}
          <GatewayRow
            title="Monobank Acquiring"
            description="Прийом оплат через Monobank. Токен — у кабінеті Monobank Acquiring → API."
            enabled={form.monobank_enabled}
            onToggle={(v) => set("monobank_enabled", v)}
          >
            <SecretField
              id="mono-token"
              label="X-Token"
              saved={saved?.monobank_token_saved ?? false}
              value={form.monobank_token}
              onChange={(v) => set("monobank_token", v)}
            />
          </GatewayRow>

          <div className="flex justify-end">
            <Button onClick={() => form && saveMut.mutate(form)} disabled={saveMut.isPending}>
              {saveMut.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Зберегти оплату
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GatewayRow({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
      {enabled && children}
    </div>
  );
}

function SecretField({
  id,
  label,
  saved,
  value,
  onChange,
}: {
  id: string;
  label: string;
  saved: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {saved && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
            <ShieldCheck className="h-3 w-3" /> збережено
          </span>
        )}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={saved ? "•••••••• (введіть, щоб замінити)" : "••••••••"}
        autoComplete="off"
      />
    </div>
  );
}
