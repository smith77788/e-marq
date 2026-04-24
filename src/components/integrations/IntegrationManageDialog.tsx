/**
 * Уніфіковане меню керування підключеним джерелом даних.
 *
 * Відкривається після успішного підключення (або з кнопки "Налаштувати" на картці).
 * Подібне до DnTradeIntegrationCard, але працює для будь-якого ready-провайдера:
 *   - статус підключення (active/disabled, last_sync, рахунки записів),
 *   - швидкі sync-кнопки на products/customers/orders,
 *   - історія останніх 10 import_jobs з помилками,
 *   - webhook URL/secret (для inbound),
 *   - кнопки ввімкнути/вимкнути та відключити.
 *
 * DN Trade має свій спеціалізований UI з health-check + dry-run +
 * mapping_errors — для нього показуємо CTA "Відкрити повну панель DN Trade".
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Power,
  RefreshCw,
  Webhook,
  XCircle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import type { IntegrationDef } from "@/lib/integrations/catalog";
import { isConnectorSupported } from "@/lib/integrations/connectors";
import { MSG } from "@/lib/glossary";

type Props = {
  integration: IntegrationDef | null;
  tenantId: string;
  onClose: () => void;
};

type IntegRow = {
  id: string;
  is_active: boolean;
  webhook_secret: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  synced_products_count: number;
  synced_customers_count: number;
  synced_orders_count: number;
  config: Record<string, unknown> | null;
};

type ImportJob = {
  id: string;
  entity_kind: string;
  status: string;
  rows_total: number;
  rows_imported: number;
  rows_failed: number;
  created_at: string;
  finished_at: string | null;
  error_summary: unknown;
};

const STATUS_TONE: Record<string, string> = {
  success: "bg-success/15 text-success border-success/40",
  completed: "bg-success/15 text-success border-success/40",
  partial: "bg-warning/15 text-warning border-warning/40",
  completed_with_errors: "bg-warning/15 text-warning border-warning/40",
  running: "bg-primary/15 text-primary border-primary/40",
  failed: "bg-destructive/15 text-destructive border-destructive/40",
};

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function IntegrationManageDialog({ integration, tenantId, onClose }: Props) {
  const qc = useQueryClient();
  const [syncEntity, setSyncEntity] = useState<"products" | "customers" | "orders" | null>(null);

  const integ = useQuery<IntegRow | null>({
    queryKey: ["tenant-integration-detail", tenantId, integration?.id],
    enabled: !!integration && !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_integrations")
        .select(
          "id, is_active, webhook_secret, last_sync_at, last_sync_status, last_sync_error, synced_products_count, synced_customers_count, synced_orders_count, config",
        )
        .eq("tenant_id", tenantId)
        .eq("provider", integration!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as IntegRow | null) ?? null;
    },
  });

  const jobs = useQuery<ImportJob[]>({
    queryKey: ["integration-jobs", tenantId, integration?.id],
    enabled: !!integration && !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select(
          "id, entity_kind, status, rows_total, rows_imported, rows_failed, created_at, finished_at, error_summary",
        )
        .eq("tenant_id", tenantId)
        .eq("source_provider", integration!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as ImportJob[];
    },
  });

  const isDnTrade = integration?.id === "dntrade";
  const supported = integration ? isConnectorSupported(integration.id) : false;
  const isWebhook = integration?.method === "webhook";

  const sync = useMutation({
    mutationFn: async (entity: "products" | "customers" | "orders") => {
      if (!integration) return;
      setSyncEntity(entity);
      // DN Trade має власний повноцінний sync-pipeline
      // (incremental, mapping_errors, dntrade_sync_errors).
      const isDn = integration.id === "dntrade";
      const url = isDn
        ? `/hooks/integrations/dntrade-sync`
        : `/api/integrations/sync/${integration.id}`;
      const body = isDn
        ? { tenant_id: tenantId, kinds: [entity] }
        : { entityKind: entity, tenantId };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        imported?: number;
        failed?: number;
        skipped?: number;
        error?: string;
        summary?: {
          products?: { upserted?: number };
          customers?: { upserted?: number };
          orders?: { inserted?: number };
          errors?: string[];
        };
      };
      if (!res.ok) throw new Error(json.error ?? "Помилка синку");
      // Нормалізуємо DN Trade summary до спільного формату
      if (isDn && json.summary) {
        const s = json.summary;
        const importedCount =
          (s.products?.upserted ?? 0) +
          (s.customers?.upserted ?? 0) +
          (s.orders?.inserted ?? 0);
        return { imported: importedCount, failed: s.errors?.length ?? 0, skipped: 0 };
      }
      return json;
    },
    onSuccess: (json) => {
      if (!json) return;
      toast.success(`Синхронізовано: ${json.imported ?? 0} рядків`, {
        description: json.failed ? `Помилок: ${json.failed}` : undefined,
      });
      void qc.invalidateQueries({ queryKey: ["integration-jobs", tenantId, integration?.id] });
      void qc.invalidateQueries({
        queryKey: ["tenant-integration-detail", tenantId, integration?.id],
      });
      void qc.invalidateQueries({ queryKey: ["tenant-integrations", tenantId] });
      void qc.invalidateQueries({ queryKey: ["import-jobs", tenantId] });
    },
    onError: (e: Error) => toast.error("Не вдалось синхронізувати", { description: e.message }),
    onSettled: () => setSyncEntity(null),
  });

  const toggleActive = useMutation({
    mutationFn: async () => {
      if (!integ.data) return;
      const { error } = await supabase
        .from("tenant_integrations")
        .update({ is_active: !integ.data.is_active })
        .eq("id", integ.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(integ.data?.is_active ? "Підключення призупинено" : "Підключення відновлено");
      void qc.invalidateQueries({
        queryKey: ["tenant-integration-detail", tenantId, integration?.id],
      });
      void qc.invalidateQueries({ queryKey: ["tenant-integrations", tenantId] });
    },
    onError: (e: Error) => toast.error(MSG.errSave, { description: e.message }),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!integ.data) return;
      const { error } = await supabase
        .from("tenant_integrations")
        .delete()
        .eq("id", integ.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Підключення видалено");
      void qc.invalidateQueries({ queryKey: ["tenant-integrations", tenantId] });
      onClose();
    },
    onError: (e: Error) => toast.error(MSG.errSave, { description: e.message }),
  });

  const generateSecret = useMutation({
    mutationFn: async () => {
      if (!integration || !tenantId) return;
      // Якщо рядка інтеграції ще немає — створюємо мінімальний (тільки для webhook-методів).
      const secret = crypto.randomUUID().replace(/-/g, "");
      if (!integ.data) {
        const { error } = await supabase.from("tenant_integrations").insert({
          tenant_id: tenantId,
          provider: integration.id,
          is_active: true,
          webhook_secret: secret,
          credentials_encrypted: null,
          config: {},
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("tenant_integrations")
          .update({ webhook_secret: secret })
          .eq("id", integ.data.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Webhook secret згенеровано");
      void qc.invalidateQueries({
        queryKey: ["tenant-integration-detail", tenantId, integration?.id],
      });
      void qc.invalidateQueries({ queryKey: ["tenant-integrations", tenantId] });
    },
    onError: (e: Error) => toast.error(MSG.errSave, { description: e.message }),
  });

  if (!integration) return null;
  const Icon = integration.icon;
  const data = integ.data;

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/integrations/inbound/${integration.id}?tenant=${tenantId}`;

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} скопійовано`));
  }

  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate">{integration.name}</span>
                {data?.is_active ? (
                  <Badge className="border-success/40 bg-success/15 text-success text-[10px]">
                    Активно
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    Призупинено
                  </Badge>
                )}
              </div>
              <div className="text-xs font-normal text-muted-foreground">Керування підключенням</div>
            </div>
          </DialogTitle>
          <DialogDescription>{integration.description}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <Tabs defaultValue="overview" className="space-y-4 py-2">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">
                Огляд
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1">
                Історія ({jobs.data?.length ?? 0})
              </TabsTrigger>
              {isWebhook && (
                <TabsTrigger value="webhook" className="flex-1">
                  Webhook
                </TabsTrigger>
              )}
              <TabsTrigger value="danger" className="flex-1 text-destructive">
                Налаштування
              </TabsTrigger>
            </TabsList>

            {/* ── Огляд ── */}
            <TabsContent value="overview" className="space-y-4">
              {isDnTrade && (
                <Alert className="border-primary/40 bg-primary/5">
                  <Activity className="h-4 w-4 text-primary" />
                  <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      DN Trade має <strong>розширену панель</strong> з health-check, dry-run, sync
                      повний/інкрементальний і журналом mapping-помилок.
                    </span>
                    <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
                      <Link to="/brand/integrations">
                        <ExternalLink className="h-3 w-3" />
                        Відкрити повну панель
                      </Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {!supported && !isWebhook && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Цей провайдер не має автоматичного pull. Використовуйте CSV-завантаження або
                    webhook для приймання даних.
                  </AlertDescription>
                </Alert>
              )}

              {/* Статистика */}
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Товари" value={data?.synced_products_count ?? 0} />
                <StatCard label="Клієнти" value={data?.synced_customers_count ?? 0} />
                <StatCard label="Замовлення" value={data?.synced_orders_count ?? 0} />
              </div>

              {/* Останній sync */}
              <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Останній синк</span>
                  <span className="font-medium">
                    {data?.last_sync_at
                      ? formatDistanceToNow(new Date(data.last_sync_at), {
                          addSuffix: true,
                          locale: uk,
                        })
                      : "ще не було"}
                  </span>
                </div>
                {data?.last_sync_status && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Статус</span>
                    <Badge
                      variant="outline"
                      className={STATUS_TONE[data.last_sync_status] ?? "text-muted-foreground"}
                    >
                      {data.last_sync_status}
                    </Badge>
                  </div>
                )}
                {data?.last_sync_error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{data.last_sync_error}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Перший імпорт — велика CTA, якщо ще нічого не синкнуто */}
              {supported && data?.is_active && !data?.last_sync_at && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Запустити перший імпорт</div>
                      <p className="text-xs text-muted-foreground">
                        Підтягнемо все, що є в {integration.name}: товари, клієнтів, замовлення.
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        const first =
                          (integration.imports[0] as
                            | "products"
                            | "customers"
                            | "orders"
                            | undefined) ?? "products";
                        sync.mutate(first);
                      }}
                      disabled={sync.isPending}
                      className="shrink-0 gap-1"
                    >
                      {sync.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      Запустити
                    </Button>
                  </div>
                </div>
              )}

              {/* Швидкі sync-кнопки */}
              {supported && data?.is_active && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Запустити синхронізацію зараз
                  </Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(["products", "customers", "orders"] as const).map((entity) => {
                      const supportsThis = integration.imports.includes(entity);
                      if (!supportsThis) return null;
                      const isThisSyncing = syncEntity === entity && sync.isPending;
                      return (
                        <Button
                          key={entity}
                          variant="outline"
                          onClick={() => sync.mutate(entity)}
                          disabled={sync.isPending}
                          className="gap-1"
                        >
                          {isThisSyncing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          {entity === "products"
                            ? "Товари"
                            : entity === "customers"
                              ? "Клієнти"
                              : "Замовлення"}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    До 1000 рядків за запуск. Дублі розпізнаються за SKU / email / external_id.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* ── Історія ── */}
            <TabsContent value="history" className="space-y-2">
              {!jobs.data || jobs.data.length === 0 ? (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertDescription>
                    Поки що жодного імпорту. Запустіть синхронізацію вище.
                  </AlertDescription>
                </Alert>
              ) : (
                jobs.data.map((j) => {
                  const icon =
                    j.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : j.status === "completed_with_errors" ? (
                      <AlertCircle className="h-4 w-4 text-warning" />
                    ) : j.status === "failed" ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    );
                  return (
                    <div
                      key={j.id}
                      className="rounded-md border border-border/40 bg-card/40 p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {icon}
                          <Badge variant="outline" className="text-[10px]">
                            {j.entity_kind}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(j.created_at), {
                              addSuffix: true,
                              locale: uk,
                            })}
                          </span>
                        </div>
                        <div className="text-xs">
                          <strong className="text-success">{j.rows_imported}</strong> /{" "}
                          {j.rows_total}
                          {j.rows_failed > 0 && (
                            <span className="ml-2 text-destructive">помилок: {j.rows_failed}</span>
                          )}
                        </div>
                      </div>
                      {Array.isArray(j.error_summary) &&
                        (j.error_summary as Array<{ row: number; message: string }>).length > 0 && (
                          <details className="mt-2 text-xs text-muted-foreground">
                            <summary className="cursor-pointer">
                              Помилки (
                              {(j.error_summary as Array<{ row: number; message: string }>).length})
                            </summary>
                            <ul className="mt-1 space-y-0.5">
                              {(j.error_summary as Array<{ row: number; message: string }>)
                                .slice(0, 5)
                                .map((e, i) => (
                                  <li key={i}>
                                    Рядок {e.row}: {e.message}
                                  </li>
                                ))}
                            </ul>
                          </details>
                        )}
                    </div>
                  );
                })
              )}
            </TabsContent>

            {/* ── Webhook ── */}
            {isWebhook && (
              <TabsContent value="webhook" className="space-y-3">
                <Alert className="border-primary/40 bg-primary/5">
                  <Webhook className="h-4 w-4 text-primary" />
                  <AlertDescription>
                    Скопіюйте URL та секрет у налаштування зовнішньої системи (Zapier, Make,
                    n8n…). Дані надсилайте методом POST.
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
                      onClick={() => copy(webhookUrl, "URL")}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    X-Webhook-Secret
                  </Label>
                  {data?.webhook_secret ? (
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={data.webhook_secret}
                        className="font-mono text-xs"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copy(data.webhook_secret!, "Секрет")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={() => generateSecret.mutate()}
                      disabled={generateSecret.isPending}
                      variant="outline"
                      className="w-full gap-1"
                    >
                      {generateSecret.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Згенерувати секрет
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Передавайте у заголовку <code>X-Webhook-Secret</code>. Тіло POST:{" "}
                    <code>{`{ entity, rows: [...] }`}</code>.
                  </p>
                </div>
              </TabsContent>
            )}

            {/* ── Налаштування / небезпека ── */}
            <TabsContent value="danger" className="space-y-3">
              <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">
                      {data?.is_active ? "Призупинити" : "Відновити"} підключення
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {data?.is_active
                        ? "Перестане синхронізувати, але збереже ключ."
                        : "Знову вмикає авто-синк і прийом webhook."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => toggleActive.mutate()}
                    disabled={toggleActive.isPending || !data}
                    className="gap-1"
                  >
                    {toggleActive.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : data?.is_active ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {data?.is_active ? "Призупинити" : "Відновити"}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-destructive">
                      Повністю відключити
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Видалить ключ і конфіг. Раніше імпортовані дані залишаться.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm(`Відключити ${integration.name}? Ключ буде видалено.`)) {
                        disconnect.mutate();
                      }
                    }}
                    disabled={disconnect.isPending || !data}
                    className="gap-1"
                  >
                    {disconnect.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Power className="h-3 w-3" />
                    )}
                    Відключити
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3 text-center">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString("uk-UA")}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
