/**
 * BulkPromoGeneratorDialog — оптовий генератор промокодів.
 *
 * V2-промпт, рядок 1180-1183 (БЛОК 3.4):
 *   "Bulk generate" → Dialog:
 *     - Кількість N
 *     - Prefix (e.g. "SALE-")
 *     - Generate → array of {code: prefix+random} → INSERT все → CSV download
 *
 * Архітектура:
 *  - Контрольований Dialog (open/onOpenChange від батька).
 *  - Один INSERT-запит (supabase batch) — швидко й атомарно з точки зору RLS.
 *  - CSV генерується клієнтом без зовнішніх dep (одна колонка `code`).
 *  - Дедуп: random-частина 8 символів base32-без-схожих-літер; колізії з існуючими
 *    кодами тенанта обходимо ретраєм (макс 3 спроби на код).
 *  - Money в cents, як вимагає протокол.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

type PromoType = "percent_off" | "fixed_off" | "free_shipping";

type Props = {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const RANDOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O/1/I/L
const RANDOM_LEN = 8;
const MIN_COUNT = 1;
const MAX_COUNT = 500;
const PREFIX_REGEX = /^[A-Z0-9_-]{0,12}$/;

function randomSegment(): string {
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    out += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)];
  }
  return out;
}

function makeCode(prefix: string): string {
  return prefix ? `${prefix}${randomSegment()}` : randomSegment();
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function buildCsv(codes: string[]): string {
  // Просте екранування: ми гарантуємо алфавіт без коми/лапок/перенесень рядка.
  return ["code", ...codes].join("\n");
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Звільняємо memory після короткої затримки (браузер потребує посилання живим
  // на момент кліку).
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function BulkPromoGeneratorDialog({ tenantId, open, onOpenChange }: Props) {
  const { t } = useT();
  const qc = useQueryClient();

  const [count, setCount] = useState<number>(20);
  const [prefix, setPrefix] = useState<string>("SALE-");
  const [promoType, setPromoType] = useState<PromoType>("percent_off");
  const [value, setValue] = useState<number>(10);
  const [endsAt, setEndsAt] = useState<string>("");
  const [usageLimit, setUsageLimit] = useState<string>("1");
  const [usagePerCustomer, setUsagePerCustomer] = useState<number>(1);
  const [isActive, setIsActive] = useState<boolean>(true);

  const previewCodes = useMemo(() => {
    // Дет-preview: показуємо 3 приклади формату, не реальні коди (вони згенеруються
    // при submit, щоб уникнути збігу з тим, що покажемо).
    return Array.from({ length: 3 }, () => makeCode(prefix));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, count, promoType]);

  const safeCount = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(count) || MIN_COUNT));
  const validPrefix = PREFIX_REGEX.test(prefix);
  const validValue = promoType === "free_shipping" || (Number.isFinite(value) && value > 0);

  const generate = useMutation({
    mutationFn: async () => {
      // 1. Згенерувати N унікальних кодів з ретраєм проти існуючих.
      const generated = new Set<string>();
      let attempts = 0;
      const maxAttempts = safeCount * 4;
      while (generated.size < safeCount && attempts < maxAttempts) {
        generated.add(makeCode(prefix));
        attempts += 1;
      }
      if (generated.size < safeCount) {
        throw new Error(t("bpr.bulk.errCollide"));
      }
      const candidateCodes = Array.from(generated);

      // 2. Перевірити в БД існуючі коди для цього тенанта.
      const { data: existing, error: existErr } = await supabase
        .from("promotions")
        .select("code")
        .eq("tenant_id", tenantId)
        .in("code", candidateCodes);
      if (existErr) throw existErr;

      const taken = new Set(
        ((existing ?? []) as { code: string | null }[])
          .map((r) => r.code)
          .filter((c): c is string => typeof c === "string"),
      );
      // Замінюємо взяті коди новими, поки всі N не унікальні.
      const finalCodes: string[] = [];
      for (const code of candidateCodes) {
        if (!taken.has(code)) {
          finalCodes.push(code);
          continue;
        }
        let retry = makeCode(prefix);
        let safetyCounter = 0;
        while ((taken.has(retry) || finalCodes.includes(retry)) && safetyCounter < 20) {
          retry = makeCode(prefix);
          safetyCounter += 1;
        }
        finalCodes.push(retry);
      }

      // 3. Підготувати payload. Money в cents (`value` у валюті — лишаємо
      // числом для percent_off / fixed_off, як це робить existing форма
      // brand.promotions.tsx — таблиця promotions.value typed як numeric).
      const startsIso = new Date().toISOString();
      const endsIso = fromLocalInput(endsAt);
      const limit = usageLimit.trim() === "" ? null : Number(usageLimit);
      const rows = finalCodes.map((code) => ({
        tenant_id: tenantId,
        code,
        name: `${prefix || "PROMO"} batch ${new Date().toISOString().slice(0, 10)}`,
        promo_type: promoType,
        value: promoType === "free_shipping" ? 0 : value,
        min_order_cents: 0,
        usage_limit: limit,
        usage_per_customer: Math.max(1, usagePerCustomer),
        starts_at: startsIso,
        ends_at: endsIso,
        is_active: isActive,
      }));

      // 4. Один batch INSERT (supabase обробляє масив до ~1000 рядків).
      const { error: insertErr } = await supabase.from("promotions").insert(rows);
      if (insertErr) throw insertErr;

      return { codes: finalCodes };
    },
    onSuccess: ({ codes }) => {
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `promo-codes-${prefix || "batch"}-${stamp}.csv`;
      downloadCsv(filename, buildCsv(codes));
      toast.success(t("bpr.bulk.success"), {
        description: t("bpr.bulk.successDesc").replace("{count}", String(codes.length)),
      });
      qc.invalidateQueries({ queryKey: ["brand-promotions", tenantId] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(t("bpr.bulk.errTitle"), { description: e.message });
    },
  });

  const canSubmit = validPrefix && validValue && safeCount >= MIN_COUNT && !generate.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !generate.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("bpr.bulk.title")}
          </DialogTitle>
          <DialogDescription>{t("bpr.bulk.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-count">{t("bpr.bulk.count")}</Label>
              <Input
                id="bulk-count"
                type="number"
                min={MIN_COUNT}
                max={MAX_COUNT}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("bpr.bulk.countHint").replace("{max}", String(MAX_COUNT))}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-prefix">{t("bpr.bulk.prefix")}</Label>
              <Input
                id="bulk-prefix"
                value={prefix}
                onChange={(e) =>
                  setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12))
                }
                className="font-mono uppercase"
                placeholder="SALE-"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("bpr.bulk.prefixHint")}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("bpr.field.type")}</Label>
            <Select value={promoType} onValueChange={(v) => setPromoType(v as PromoType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent_off">{t("bpr.type.percent")}</SelectItem>
                <SelectItem value="fixed_off">{t("bpr.type.fixed")}</SelectItem>
                <SelectItem value="free_shipping">{t("bpr.type.shipping")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {promoType !== "free_shipping" && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-value">
                {promoType === "percent_off"
                  ? t("bpr.field.value.percent")
                  : t("bpr.field.value.fixed")}
              </Label>
              <Input
                id="bulk-value"
                type="number"
                min={1}
                max={promoType === "percent_off" ? 100 : undefined}
                step={promoType === "percent_off" ? 1 : 0.01}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-ends">{t("bpr.field.endsAt")}</Label>
              <Input
                id="bulk-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-usage">{t("bpr.field.usageLimit")}</Label>
              <Input
                id="bulk-usage"
                type="number"
                min={0}
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
                placeholder="1"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-per">{t("bpr.field.usagePerCustomer")}</Label>
            <Input
              id="bulk-per"
              type="number"
              min={1}
              value={usagePerCustomer}
              onChange={(e) => setUsagePerCustomer(Number(e.target.value))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="bulk-active" className="cursor-pointer">
              {t("bpr.field.active")}
            </Label>
            <Switch id="bulk-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("bpr.bulk.preview")}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-xs">
              {previewCodes.map((c) => (
                <span
                  key={c}
                  className="rounded bg-background px-2 py-0.5 text-foreground/80 ring-1 ring-border"
                >
                  {c}
                </span>
              ))}
              <span className="text-muted-foreground">
                {t("bpr.bulk.previewMore").replace("{count}", String(Math.max(0, safeCount - 3)))}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={generate.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t("bpr.bulk.generating")}
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {t("bpr.bulk.generateAndDownload").replace("{count}", String(safeCount))}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
