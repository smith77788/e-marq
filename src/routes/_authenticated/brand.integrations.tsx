/**
 * Integrations Hub — каталог усіх джерел даних, які підтримує MARQ.
 *
 * UX-принципи:
 *  - чесні статуси (ready / beta / coming soon),
 *  - категорії: e-commerce, бухгалтерія, Україна, платежі, універсальні,
 *  - історія імпортів (import_jobs) знизу — щоб людина бачила, що відбувалось,
 *  - кнопка «Підключити» відкриває IntegrationWizard.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Search,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { IntegrationWizard } from "@/components/integrations/IntegrationWizard";
import {
  CATEGORIES,
  INTEGRATIONS,
  getIntegration,
  type IntegrationCategory,
  type IntegrationDef,
} from "@/lib/integrations/catalog";
import { isConnectorSupported } from "@/lib/integrations/connectors";

export const Route = createFileRoute("/_authenticated/brand/integrations")({
  component: IntegrationsHubPage,
});

function IntegrationsHubPage() {
  const { current, currentTenantId, loading } = useTenantContext();
  const qc = useQueryClient();
  const [active, setActive] = useState<IntegrationDef | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<IntegrationCategory | "all">("all");
  const [syncTarget, setSyncTarget] = useState<IntegrationDef | null>(null);
  const [syncEntity, setSyncEntity] = useState<"products" | "customers" | "orders">("products");
  const [syncing, setSyncing] = useState<string | null>(null);

  const { data: connected } = useQuery({
    queryKey: ["tenant-integrations", currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_integrations")
        .select("provider, is_active, last_sync_at, last_sync_status")
        .eq("tenant_id", currentTenantId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["import-jobs", currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("id, source_provider, entity_kind, status, rows_total, rows_imported, rows_failed, created_at, finished_at")
        .eq("tenant_id", currentTenantId!)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  const connectedSet = useMemo(
    () => new Set((connected ?? []).filter((c) => c.is_active).map((c) => c.provider)),
    [connected],
  );

  async function runSync(provider: string, entity: "products" | "customers" | "orders") {
    if (!currentTenantId) return;
    setSyncing(provider);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Сесія не знайдена");
      const res = await fetch(`/api/integrations/sync/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entityKind: entity, tenantId: currentTenantId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Помилка синку");
      toast.success(`Синхронізовано: ${json.imported} рядків`, {
        description: json.failed > 0 ? `Помилок: ${json.failed}` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["import-jobs", currentTenantId] });
      qc.invalidateQueries({ queryKey: ["tenant-integrations", currentTenantId] });
    } catch (e) {
      toast.error("Не вдалось синхронізувати", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncing(null);
      setSyncTarget(null);
    }
  }

  const filtered = useMemo(() => {
    return INTEGRATIONS.filter((i) => {
      if (tab !== "all" && i.category !== tab) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tab, query]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      </div>
    );
  }

  if (!currentTenantId) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Спочатку оберіть бренд</CardTitle>
            <CardDescription>
              Інтеграції налаштовуються для конкретного бренду. Поверніться на головну і виберіть бренд.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/brand">
                <ArrowLeft className="mr-1 h-4 w-4" />
                До бренду
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/brand" className="hover:text-foreground">
            ← {current?.tenant_name ?? "Бренд"}
          </Link>
          <span>·</span>
          <span>Інтеграції та імпорт</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Підключіть будь-яке джерело даних
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Магазин, бухгалтерія, каса чи проста табличка — ми приймаємо все. Виберіть систему нижче,
          і MARQ почне імпортувати товари, клієнтів і замовлення автоматично.
        </p>
      </header>

      {/* Пошук + фільтр */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Знайти Shopify, Stripe, 1С…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Усього: <strong>{INTEGRATIONS.length}</strong> джерел · Підключено:{" "}
          <strong className="text-success">{connectedSet.size}</strong>
        </div>
      </div>

      {/* Категорії */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-secondary/40 p-1">
          <TabsTrigger value="all" className="text-xs">
            Усі
          </TabsTrigger>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <TabsTrigger key={c.id} value={c.id} className="text-xs">
                <Icon className="mr-1 h-3 w-3" />
                {c.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Нічого не знайшлось. Спробуйте інший запит або вкладку.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  isConnected={connectedSet.has(integration.id)}
                  onSelect={setActive}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Журнал останніх імпортів */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал імпортів</CardTitle>
          <CardDescription>
            Останні 15 запусків. Тут видно, що завантажилось, а де були помилки.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!jobs || jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Поки що жодного імпорту не було. Підключіть джерело вище, щоб почати.
            </p>
          ) : (
            jobs.map((j) => {
              const integ = getIntegration(j.source_provider);
              const statusIcon =
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
                  className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-card/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {statusIcon}
                    <span className="truncate font-medium">
                      {integ?.name ?? j.source_provider}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {j.entity_kind}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
                    <span>
                      <strong className="text-success">{j.rows_imported}</strong> /{" "}
                      {j.rows_total}
                    </span>
                    {j.rows_failed > 0 && (
                      <span className="text-destructive">помилок: {j.rows_failed}</span>
                    )}
                    <span>{new Date(j.created_at).toLocaleString("uk-UA")}</span>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <IntegrationWizard
        integration={active}
        tenantId={currentTenantId}
        onClose={() => setActive(null)}
      />
    </div>
  );
}
