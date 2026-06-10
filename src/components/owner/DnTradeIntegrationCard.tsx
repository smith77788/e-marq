/**
 * DN Trade integration card.
 * - Owner enters ApiKey і зберігає (з валідацією через DN Trade /products/stores).
 * - Кнопки: повний sync, інкрементальний sync, dry-run (без запису).
 * - Перегляд останніх mapping errors.
 * - Генерація webhook URL + secret для push-подій з DN Trade.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  HeartPulse,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  TestTube,
  TriangleAlert,
  Webhook,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { authHeaders, ensureAuthenticatedSession } from "@/lib/auth/ensureSession";
import { MSG } from "@/lib/glossary";

type Props = { tenantId: string };

type IntegRow = {
  id: string;
  is_active: boolean;
  credentials_encrypted: string | null;
  webhook_secret: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  synced_products_count: number;
  synced_customers_count: number;
  synced_orders_count: number;
};

type MappingError = {
  id: string;
  kind: string;
  external_id: string | null;
  message: string;
  occurred_at: string;
};

type DryRunSummary = {
  products: { fetched: number; upserted: number };
  customers: { fetched: number; upserted: number };
  orders: { fetched: number; inserted: number; skipped: number };
  errors: string[];
  mapping_errors: Array<{ kind: string; external_id: string | null; message: string }>;
  samples?: { products: unknown[]; customers: unknown[]; orders: unknown[] };
};

async function authHeader(): Promise<Record<string, string>> {
  return authHeaders();
}

function randomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function DnTradeIntegrationCard({ tenantId }: Props) {
  const qc = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunSummary | null>(null);
  const [showSamples, setShowSamples] = useState(false);

  const integ = useQuery({
    queryKey: ["dntrade-integration", tenantId],
    refetchInterval: (q) => {
      const status = q.state.data?.last_sync_status;
      return status === "queued" || status === "running" ? 3_000 : 60_000;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_integrations")
        .select(
          "id, is_active, credentials_encrypted, webhook_secret, last_sync_at, last_sync_status, last_sync_error, synced_products_count, synced_customers_count, synced_orders_count",
        )
        .eq("tenant_id", tenantId)
        .eq("provider", "dntrade")
        .maybeSingle();
      if (error) throw error;
      return data as IntegRow | null;
    },
  });

  const mappingErrors = useQuery({
    queryKey: ["dntrade-mapping-errors", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dntrade_sync_errors")
        .select("id, kind, external_id, message, occurred_at")
        .eq("tenant_id", tenantId)
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as MappingError[];
    },
    enabled: !!integ.data?.credentials_encrypted,
  });

  // Live health-check (polling 60s) — викликає той самий ендпойнт, що адмін cron.
  const health = useQuery({
    queryKey: ["dntrade-health", tenantId],
    enabled: !!integ.data,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/hooks/integrations/dntrade-webhook-health?tenant=${tenantId}`, {
        headers: await authHeader(),
      });
      const json = (await res.json()) as {
        status: "healthy" | "degraded" | "unhealthy" | "missing" | "error";
        ready: boolean;
        blockers?: string[];
        warnings?: string[];
      };
      return { ...json, http: res.status };
    },
  });

  useEffect(() => {
    if (integ.data?.credentials_encrypted) {
      setApiKey(integ.data.credentials_encrypted);
    }
  }, [integ.data?.credentials_encrypted]);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      await ensureAuthenticatedSession();
      const trimmed = key.trim();
      if (!trimmed) throw new Error("Введіть ключ доступу DN Trade");
      let verifyStatus: "verified" | "failed" | "not_checked" = "not_checked";
      let verifyMessage: string | null = null;
      try {
        const verifyRes = await fetch("/hooks/integrations/dntrade-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ tenant_id: tenantId, api_key: trimmed }),
        });
        const verifyJson = await verifyRes.json();
        if (verifyRes.ok && verifyJson.valid) {
          verifyStatus = "verified";
        } else {
          verifyStatus = "failed";
          verifyMessage = verifyJson.message ?? verifyJson.error ?? "DN Trade не підтвердив ключ";
        }
      } catch (e) {
        verifyStatus = "failed";
        verifyMessage = e instanceof Error ? e.message : String(e);
      }
      const { error } = await supabase.rpc("save_tenant_integration", {
        _tenant_id: tenantId,
        _provider: "dntrade",
        _credentials: trimmed,
        _config: {
          verification: {
            status: verifyStatus,
            checked_at: new Date().toISOString(),
            message: verifyMessage,
          },
        },
        _last_sync_status: verifyStatus === "verified" ? "verified" : "saved_unverified",
        _last_sync_error: verifyStatus === "failed" ? (verifyMessage ?? undefined) : undefined,
        _webhook_secret: undefined,
      });
      if (error) throw error;
      return { verifyStatus, verifyMessage };
    },
    onSuccess: (res) => {
      if (res.verifyStatus === "verified") {
        toast.success("Готово · DN Trade підключено і перевірено");
      } else {
        toast.success("DN Trade збережено", {
          description: res.verifyMessage
            ? `Перевірка не пройшла: ${res.verifyMessage}`
            : "Запустіть синхронізацію пізніше, коли сервіс буде доступний.",
        });
      }
      void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : MSG.errSave),
  });

  const sync = useMutation({
    mutationFn: async (full: boolean) => {
      await ensureAuthenticatedSession();
      const headers = { "Content-Type": "application/json", ...(await authHeader()) };
      const res = await fetch("/hooks/integrations/dntrade-sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ tenant_id: tenantId, full, async: true }),
      });
      const json = (await res.json()) as {
        queued?: boolean;
        jobId?: string;
        error?: string;
        summary?: DryRunSummary;
      };
      if (!res.ok) throw new Error(json.error ?? MSG.errSync);
      if (json.queued && json.jobId) {
        void fetch("/hooks/integrations/dntrade-sync", {
          method: "POST",
          headers,
          body: JSON.stringify({ tenant_id: tenantId, full, jobId: json.jobId }),
        }).finally(() => {
          void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
          void qc.invalidateQueries({ queryKey: ["dntrade-mapping-errors", tenantId] });
          void qc.invalidateQueries({ queryKey: ["import-jobs", tenantId] });
        });
        return { queued: true } as const;
      }
      return json.summary as DryRunSummary;
    },
    onSuccess: (s) => {
      if ((s as { queued?: boolean }).queued) {
        toast.success("Імпорт DN Trade запущено у фоні", {
          description: "Стан оновиться автоматично після завершення.",
        });
        void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
        void qc.invalidateQueries({ queryKey: ["import-jobs", tenantId] });
        return;
      }
      const summary = s as DryRunSummary;
      toast.success(
        `Готово · товари: ${summary.products.upserted}, клієнти: ${summary.customers.upserted}, замовлення: ${summary.orders.inserted}`,
      );
      if (summary.mapping_errors?.length) {
        toast.warning(`${summary.mapping_errors.length} невідповідностей — перегляньте нижче`);
      }
      void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
      void qc.invalidateQueries({ queryKey: ["dntrade-mapping-errors", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : MSG.errSync),
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      await ensureAuthenticatedSession();
      const res = await fetch("/hooks/integrations/dntrade-dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Пробний запуск не вдався");
      return json.summary as DryRunSummary;
    },
    onSuccess: (s) => {
      setDryRunResult(s);
      toast.success(
        `Готово · знайшли товарів ${s.products.fetched}, клієнтів ${s.customers.fetched}, замовлень ${s.orders.fetched}`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : MSG.errGeneric),
  });

  const generateWebhookSecret = useMutation({
    mutationFn: async () => {
      await ensureAuthenticatedSession();
      const secret = randomSecret();
      const { error } = await supabase.rpc("set_tenant_integration_webhook_secret", {
        _tenant_id: tenantId,
        _provider: "dntrade",
        _webhook_secret: secret,
      });
      if (error) throw error;
      return secret;
    },
    onSuccess: () => {
      toast.success("Готово · ключ для автоматичних сповіщень створено");
      void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : MSG.errGeneric),
  });

  const data = integ.data;
  const isConfigured = !!data?.credentials_encrypted;
  const lastStatus = data?.last_sync_status ?? null;

  const webhookUrl = useMemo(() => {
    if (!data?.webhook_secret) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/hooks/integrations/dntrade-webhook?tenant=${tenantId}&secret=${data.webhook_secret}`;
  }, [data?.webhook_secret, tenantId]);

  const healthData = health.data;
  const healthTone =
    healthData?.status === "healthy"
      ? {
          className: "border-success/40 text-success",
          icon: CheckCircle2,
          label: "стан: усе працює",
        }
      : healthData?.status === "degraded"
        ? {
            className: "border-warning/40 text-warning",
            icon: TriangleAlert,
            label: "стан: є попередження",
          }
        : healthData
          ? {
              className: "border-destructive/40 text-destructive",
              icon: HeartPulse,
              label: "стан: не працює",
            }
          : null;
  const healthTooltip = healthData
    ? [
        ...(healthData.blockers ?? []).map((b) => `⛔ ${b}`),
        ...(healthData.warnings ?? []).map((w) => `⚠ ${w}`),
      ].join("\n") || "Перевірок без зауважень."
    : "Перевіряємо стан…";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Plug className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Підключення до DN Trade</CardTitle>
            {isConfigured && (
              <Badge variant="outline" className="border-success/40 text-success text-[10px]">
                <ShieldCheck className="mr-1 h-3 w-3" /> підключено
              </Badge>
            )}
            {healthTone && (
              <Badge
                variant="outline"
                className={`text-[10px] ${healthTone.className}`}
                title={healthTooltip}
              >
                <healthTone.icon className="mr-1 h-3 w-3" /> {healthTone.label}
              </Badge>
            )}
          </div>
          {isSuperAdmin && (
            <Link
              to="/admin/dntrade-health"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Activity className="h-3 w-3" /> Адмін-панель стану
            </Link>
          )}
        </div>
        <CardDescription className="text-xs">
          Підтягуємо товари, залишки, клієнтів і замовлення з{" "}
          <a
            href="https://dntrade.com.ua"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            dntrade.com.ua
          </a>
          . Створіть ключ доступу у{" "}
          <span className="font-mono text-foreground">Опції → Інтеграції → API DNTrade</span> і
          вставте сюди.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dntrade-key" className="text-xs">
            Ключ доступу DN Trade
          </Label>
          <div className="flex gap-2">
            <Input
              id="dntrade-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="вставте ключ доступу"
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Сховати" : "Показати"}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => saveKey.mutate(apiKey)}
            disabled={saveKey.isPending || !apiKey.trim()}
          >
            {saveKey.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Зберегти підключення
          </Button>
        </div>

        {isConfigured && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => sync.mutate(false)}
                  disabled={sync.isPending || dryRun.isPending}
                >
                  {sync.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3 w-3" />
                  )}
                  Підтягнути зміни
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => sync.mutate(true)}
                  disabled={sync.isPending || dryRun.isPending}
                >
                  Повна синхронізація
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => dryRun.mutate()}
                  disabled={sync.isPending || dryRun.isPending}
                >
                  {dryRun.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <TestTube className="mr-1 h-3 w-3" />
                  )}
                  Пробний запуск (нічого не зміниться)
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat label="Товари" value={data?.synced_products_count ?? 0} />
                <Stat label="Клієнти" value={data?.synced_customers_count ?? 0} />
                <Stat label="Замовлення" value={data?.synced_orders_count ?? 0} />
              </div>

              <div className="text-xs text-muted-foreground">
                Остання синхронізація:{" "}
                {data?.last_sync_at
                  ? formatDistanceToNow(new Date(data.last_sync_at), {
                      addSuffix: true,
                      locale: uk,
                    })
                  : "ще не було"}{" "}
                · стан:{" "}
                <span
                  className={
                    lastStatus === "success"
                      ? "text-success"
                      : lastStatus === "failed"
                        ? "text-destructive"
                        : lastStatus === "partial"
                          ? "text-warning"
                          : "text-foreground"
                  }
                >
                  {lastStatus === "success"
                    ? "успішно"
                    : lastStatus === "failed"
                      ? "не вдалося"
                      : lastStatus === "partial"
                        ? "частково"
                        : (lastStatus ?? "—")}
                </span>
                {data?.last_sync_error && (
                  <div className="mt-1 text-destructive">{data.last_sync_error.slice(0, 200)}</div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Автоматична синхронізація — щогодини. Кнопки вище — ручний запуск.
              </p>
            </div>

            {/* Результат пробного запуску */}
            {dryRunResult && (
              <>
                <Separator />
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                      <TestTube className="h-3 w-3" /> Результат пробного запуску (нічого не
                      записано)
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowSamples((s) => !s)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      {showSamples ? "Сховати приклади" : "Показати приклади"}
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Товари (знайдено)" value={dryRunResult.products.fetched} />
                    <Stat label="Клієнти (знайдено)" value={dryRunResult.customers.fetched} />
                    <Stat label="Замовлення (знайдено)" value={dryRunResult.orders.fetched} />
                  </div>
                  {dryRunResult.mapping_errors.length > 0 && (
                    <div className="text-xs text-destructive">
                      {dryRunResult.mapping_errors.length} невідповідностей — деталі нижче ↓
                    </div>
                  )}
                  {showSamples && dryRunResult.samples && (
                    <div className="space-y-2">
                      {(["products", "customers", "orders"] as const).map((k) => {
                        const labels: Record<typeof k, string> = {
                          products: "Товари",
                          customers: "Клієнти",
                          orders: "Замовлення",
                        };
                        return (
                          <details
                            key={k}
                            className="rounded border border-border/60 bg-card/40 p-2"
                          >
                            <summary className="cursor-pointer text-xs font-medium">
                              {labels[k]} ({dryRunResult.samples?.[k].length ?? 0})
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                              {JSON.stringify(dryRunResult.samples?.[k], null, 2)}
                            </pre>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Невідповідності даних */}
            {mappingErrors.data && mappingErrors.data.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    Останні невідповідності даних ({mappingErrors.data.length})
                  </div>
                  <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-border bg-card/40 p-2">
                    {mappingErrors.data.map((err) => (
                      <div
                        key={err.id}
                        className="border-b border-border/50 pb-1 text-[11px] last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant="outline"
                            className="border-destructive/40 text-[10px] text-destructive"
                          >
                            {err.kind === "product"
                              ? "товар"
                              : err.kind === "customer"
                                ? "клієнт"
                                : err.kind === "order"
                                  ? "замовлення"
                                  : err.kind}
                          </Badge>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {err.external_id ?? "—"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-foreground">{err.message}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(err.occurred_at), {
                            addSuffix: true,
                            locale: uk,
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Автоматичні сповіщення від DN Trade */}
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Webhook className="h-3 w-3 text-primary" /> Автоматичні сповіщення від DN Trade
              </div>
              {data?.webhook_secret && webhookUrl ? (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Скопіюйте посилання і вставте в DN Trade як адресу для подій. Коли DN Trade щось
                    змінює — ми одразу підтягуємо ці зміни.
                  </p>
                  <div className="flex gap-2">
                    <Input value={webhookUrl} readOnly className="font-mono text-[10px]" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        toast.success(MSG.copied);
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => generateWebhookSecret.mutate()}
                    disabled={generateWebhookSecret.isPending}
                  >
                    {generateWebhookSecret.isPending && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    Створити новий ключ
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Ще не налаштовано. Створіть ключ — і отримаєте посилання, яке треба вставити в
                    DN Trade.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => generateWebhookSecret.mutate()}
                    disabled={generateWebhookSecret.isPending}
                  >
                    {generateWebhookSecret.isPending && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    Створити посилання для сповіщень
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}
