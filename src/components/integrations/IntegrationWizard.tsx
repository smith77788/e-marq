/**
 * Wizard підключення джерела даних — простий 3-крокова форма українською.
 *
 * Крок 1: Інструкція + поле введення (ключ, URL, або файл).
 * Крок 2: Превʼю даних + автомапінг колонок (для CSV/Excel).
 * Крок 3: Запуск імпорту + результат.
 *
 * Принцип «простоти для підлітка-власника»:
 *  — мова без термінів,
 *  — кожен крок з підказкою «що це і навіщо»,
 *  — помилки чітко проговорені,
 *  — fallback на CSV-завантаження, якщо OAuth не готовий.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { CANONICAL_FIELDS, autoMap, parseFile, type EntityKind, type ParseResult } from "@/lib/integrations/parser";
import { runImport, type ImportResult } from "@/lib/integrations/importer";
import {
  METHOD_LABELS,
  type IntegrationDef,
} from "@/lib/integrations/catalog";
import { MSG } from "@/lib/glossary";

type IntegrationInsert = Database["public"]["Tables"]["tenant_integrations"]["Insert"];

type Props = {
  integration: IntegrationDef | null;
  tenantId: string;
  onClose: () => void;
};

type Step = 1 | 2 | 3;

const ENTITY_LABELS: Record<EntityKind, string> = {
  products: "Товари",
  customers: "Клієнти",
  orders: "Замовлення",
};

export function IntegrationWizard({ integration, tenantId, onClose }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [entityKind, setEntityKind] = useState<EntityKind>("products");
  const [apiKey, setApiKey] = useState("");
  const [domain, setDomain] = useState("");
  const [restUrl, setRestUrl] = useState("");
  const [parsedFile, setParsedFile] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  if (!integration) return null;

  const Icon = integration.icon;
  const isFileBased = integration.method === "csv" || integration.method === "sheets";
  const isApiKey = integration.method === "apiKey";
  const isWebhook = integration.method === "webhook";
  const isRest = integration.method === "rest";
  const isComingSoon = integration.status === "comingSoon";

  function reset() {
    setStep(1);
    setApiKey("");
    setDomain("");
    setRestUrl("");
    setParsedFile(null);
    setMapping({});
    setResult(null);
    setParseError(null);
  }

  async function handleFile(file: File) {
    try {
      setParseError(null);
      const parsed = await parseFile(file);
      if (parsed.rows.length === 0) {
        setParseError("Файл порожній або не містить даних. Перевірте формат.");
        return;
      }
      setParsedFile(parsed);
      setMapping(autoMap(parsed.headers, entityKind));
      setStep(2);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Не вдалось прочитати файл");
    }
  }

  // Зберегти інтеграцію (API key / webhook / REST) у tenant_integrations
  const saveConn = useMutation({
    mutationFn: async () => {
      if (!integration) throw new Error("integration missing");
      const config: Record<string, unknown> = {};
      if (domain) config.domain = domain;
      if (restUrl) config.url = restUrl;
      const webhookSecret = isWebhook ? crypto.randomUUID().replace(/-/g, "") : null;

      const payload: IntegrationInsert = {
        tenant_id: tenantId,
        provider: integration.id,
        is_active: true,
        credentials_encrypted: apiKey || null,
        config: config as IntegrationInsert["config"],
        webhook_secret: webhookSecret,
      };

      const { data, error } = await supabase
        .from("tenant_integrations")
        .upsert(payload, { onConflict: "tenant_id,provider" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-integrations", tenantId] });
      toast.success(MSG.saved);
      setStep(3);
    },
    onError: (e: Error) => toast.error(MSG.errSave, { description: e.message }),
  });

  async function runImportNow() {
    if (!parsedFile || !integration) return;
    const providerId = integration.id;
    setImporting(true);
    try {
      const res = await runImport({
        tenantId,
        sourceProvider: providerId,
        sourceKind: "manual",
        entityKind,
        rows: parsedFile.rows,
        mapping,
      });
      setResult(res);
      setStep(3);
      qc.invalidateQueries({ queryKey: ["tenant-integrations", tenantId] });
      if (res.failed === 0) {
        toast.success(`${MSG.imported}: ${res.imported}`);
      } else {
        toast.warning(`Імпортовано ${res.imported}, з помилками: ${res.failed}`);
      }
    } catch (e) {
      toast.error("Не вдалось імпортувати", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setImporting(false);
    }
  }

  const webhookUrl = `${window.location.origin}/api/public/integrations/inbound/${integration.id}?tenant=${tenantId}`;

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(MSG.copied));
  }

  const canSaveConn =
    (isApiKey && apiKey.trim().length > 0) ||
    (isRest && restUrl.trim().length > 0) ||
    isWebhook;

  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && (onClose(), reset())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <div>{integration.name}</div>
              <div className="text-xs font-normal text-muted-foreground">
                {METHOD_LABELS[integration.method]} · крок {step} з 3
              </div>
            </div>
          </DialogTitle>
          <DialogDescription>{integration.description}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {/* ── Крок 1: інструкція + збір даних ── */}
          {step === 1 && (
            <div className="space-y-4 py-2">
              {isComingSoon && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Поки готується повна інтеграція.</strong> Скористайтесь альтернативою:{" "}
                    {integration.fallback ?? "експорт CSV з вашої системи + завантаження файлу"}.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Як підключити (4 кроки)
                </Label>
                <ol className="space-y-2">
                  {integration.instructions.map((line, i) => (
                    <li key={i} className="flex gap-3 rounded-md border border-border/40 bg-card/40 p-3 text-sm">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{line}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {integration.requires && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Потрібно з вашого боку:</strong> {integration.requires}
                  </AlertDescription>
                </Alert>
              )}

              {/* CSV / Sheets — кнопка завантаження файлу */}
              {isFileBased && (
                <div className="space-y-3 rounded-lg border-2 border-dashed border-border/60 bg-muted/20 p-6 text-center">
                  <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground" />
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Тип даних у файлі
                    </Label>
                    <Select value={entityKind} onValueChange={(v) => setEntityKind(v as EntityKind)}>
                      <SelectTrigger className="mx-auto mt-1 max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="products">{ENTITY_LABELS.products}</SelectItem>
                        <SelectItem value="customers">{ENTITY_LABELS.customers}</SelectItem>
                        <SelectItem value="orders">{ENTITY_LABELS.orders}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    id="file-upload"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                  <Button asChild className="gap-2">
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <Upload className="h-4 w-4" />
                      Вибрати CSV або Excel файл
                    </label>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Підтримуємо CSV (UTF-8 та CP1251), XLSX, XLS. Розмір — до 10 МБ.
                  </p>
                </div>
              )}

              {/* API key */}
              {isApiKey && (
                <div className="space-y-3">
                  {(integration.id === "shopify" ||
                    integration.id === "poster_pos" ||
                    integration.id === "woocommerce") && (
                    <div className="space-y-1">
                      <Label htmlFor="domain">Домен / URL вашого магазину</Label>
                      <Input
                        id="domain"
                        placeholder={
                          integration.id === "shopify"
                            ? "my-shop.myshopify.com"
                            : integration.id === "woocommerce"
                              ? "https://мій-сайт.com"
                              : "joinposter.com"
                        }
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="apikey">Ключ доступу</Label>
                    <Input
                      id="apikey"
                      type="password"
                      placeholder="вставте ключ сюди…"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Ключ зберігається у захищеному вигляді. Тільки наш сервер його бачить.
                    </p>
                  </div>
                </div>
              )}

              {/* REST */}
              {isRest && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="resturl">URL вашого endpoint</Label>
                    <Input
                      id="resturl"
                      placeholder="https://api.example.com/data.json"
                      value={restUrl}
                      onChange={(e) => setRestUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="restkey">Заголовок Authorization (необовʼязково)</Label>
                    <Input
                      id="restkey"
                      placeholder="Bearer ваш-токен"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Webhook */}
              {isWebhook && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertDescription className="space-y-2">
                    <div>
                      Натисніть «Створити підключення» — і отримаєте унікальний URL та секретний підпис,
                      які треба вставити у Zapier / Make / іншу систему.
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* ── Крок 2: мапінг колонок (тільки для файлів) ── */}
          {step === 2 && parsedFile && (
            <div className="space-y-4 py-2">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <AlertDescription>
                  Зчитано <strong>{parsedFile.totalRows}</strong> рядків. Перевірте — куди йде яка
                  колонка. Система здогадалась сама, але ви можете змінити.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                {CANONICAL_FIELDS[entityKind].map((field) => (
                  <div key={field.id} className="grid grid-cols-2 items-center gap-3">
                    <Label className="flex items-center gap-1 text-sm">
                      {field.label}
                      {field.required && <span className="text-destructive">*</span>}
                    </Label>
                    <Select
                      value={mapping[field.id] ?? "__none__"}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [field.id]: v === "__none__" ? "" : v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— не імпортувати —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— не імпортувати —</SelectItem>
                        {parsedFile.headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Превʼю · перші 3 рядки
                </div>
                <div className="space-y-1 text-xs">
                  {parsedFile.rows.slice(0, 3).map((r, i) => (
                    <div key={i} className="truncate font-mono">
                      {Object.entries(r)
                        .slice(0, 5)
                        .map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`)
                        .join("  · ")}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Крок 3: результат ── */}
          {step === 3 && (
            <div className="space-y-4 py-2">
              {/* Імпорт результат */}
              {result && (
                <Alert className={result.failed === 0 ? "border-success/40 bg-success/5" : ""}>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertDescription className="space-y-1">
                    <div className="font-semibold">Готово!</div>
                    <div>
                      Усього рядків: <strong>{result.total}</strong>, успішно:{" "}
                      <strong className="text-success">{result.imported}</strong>, пропущено:{" "}
                      <strong>{result.skipped}</strong>, з помилками:{" "}
                      <strong className={result.failed > 0 ? "text-destructive" : ""}>
                        {result.failed}
                      </strong>
                    </div>
                    {result.errors.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer">Показати помилки</summary>
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {result.errors.slice(0, 10).map((e, i) => (
                            <li key={i}>
                              Рядок {e.row}: {e.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Webhook інструкція */}
              {isWebhook && saveConn.data?.webhook_secret && (
                <div className="space-y-3">
                  <Alert className="border-success/40 bg-success/5">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <AlertDescription>
                      <strong>Підключення створено.</strong> Скопіюйте ці два значення і вставте у
                      Zapier / Make / іншу систему.
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Webhook URL
                    </Label>
                    <div className="flex gap-2">
                      <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copy(webhookUrl)}
                        aria-label="Копіювати Webhook URL"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Секретний підпис (заголовок X-Webhook-Secret)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={saveConn.data.webhook_secret}
                        className="font-mono text-xs"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copy(saveConn.data!.webhook_secret!)}
                        aria-label="Копіювати секретний підпис"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* API key збережено */}
              {(isApiKey || isRest) && saveConn.data && !result && (
                <Alert className="border-success/40 bg-success/5">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertDescription>
                    <strong>Підключення збережено.</strong> Тепер можна налаштувати автоматичну
                    синхронізацію або запустити перший імпорт вручну з картки інтеграції.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {parseError && (
            <Alert variant="destructive" className="my-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
        </ScrollArea>

        {/* ── Footer / навігація ── */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 1) {
                onClose();
                reset();
              } else {
                setStep((s) => (s === 3 ? 2 : 1) as Step);
              }
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {step === 1 ? "Закрити" : "Назад"}
          </Button>

          <div className="flex gap-2">
            {step === 1 && (isApiKey || isRest || isWebhook) && (
              <Button
                disabled={!canSaveConn || saveConn.isPending}
                onClick={() => saveConn.mutate()}
                className="gap-1"
              >
                {saveConn.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Створити підключення
              </Button>
            )}
            {step === 2 && (
              <Button onClick={runImportNow} disabled={importing} className="gap-1">
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Імпортуємо…
                  </>
                ) : (
                  <>
                    Запустити імпорт
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={() => {
                  onClose();
                  reset();
                }}
                className="gap-1"
              >
                <CheckCircle2 className="h-4 w-4" />
                Готово
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
