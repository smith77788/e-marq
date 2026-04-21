/**
 * DN Trade integration card.
 * - Owner enters ApiKey (paste from DN Trade → Опції → Інтеграції → API DNTrade).
 * - "Verify & save" — server-side check + upsert у tenant_integrations.
 * - "Sync now" — запускає повний sync (full=true перший раз, далі інкрементально).
 * - Показує статус останньої синхронізації та лічильники.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type IntegRow = {
  id: string;
  is_active: boolean;
  credentials_encrypted: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  synced_products_count: number;
  synced_customers_count: number;
  synced_orders_count: number;
};

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function DnTradeIntegrationCard({ tenantId }: Props) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const integ = useQuery({
    queryKey: ["dntrade-integration", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_integrations")
        .select(
          "id, is_active, credentials_encrypted, last_sync_at, last_sync_status, last_sync_error, synced_products_count, synced_customers_count, synced_orders_count",
        )
        .eq("tenant_id", tenantId)
        .eq("provider", "dntrade")
        .maybeSingle();
      if (error) throw error;
      return data as IntegRow | null;
    },
  });

  useEffect(() => {
    if (integ.data?.credentials_encrypted) {
      setApiKey(integ.data.credentials_encrypted);
    }
  }, [integ.data?.credentials_encrypted]);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      const trimmed = key.trim();
      if (!trimmed) throw new Error("Введіть API key");
      // Verify first
      const verifyRes = await fetch("/hooks/integrations/dntrade-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ tenant_id: tenantId, api_key: trimmed }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyJson.error ?? "Verify failed");
      if (!verifyJson.valid) {
        throw new Error(`DN Trade відхилив ключ: ${verifyJson.message ?? "невірний ключ"}`);
      }
      // Upsert
      const { error } = await supabase
        .from("tenant_integrations")
        .upsert(
          {
            tenant_id: tenantId,
            provider: "dntrade",
            credentials_encrypted: trimmed,
            is_active: true,
          },
          { onConflict: "tenant_id,provider" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("DN Trade підключено");
      void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Не вдалося зберегти"),
  });

  const sync = useMutation({
    mutationFn: async (full: boolean) => {
      const res = await fetch("/hooks/integrations/dntrade-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ tenant_id: tenantId, full }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json.summary as {
        products: { fetched: number; upserted: number };
        customers: { fetched: number; upserted: number };
        orders: { fetched: number; inserted: number; skipped: number };
        errors: string[];
      };
    },
    onSuccess: (s) => {
      toast.success(
        `Sync OK · товари: ${s.products.upserted}, клієнти: ${s.customers.upserted}, замовлення: ${s.orders.inserted}`,
      );
      void qc.invalidateQueries({ queryKey: ["dntrade-integration", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sync failed"),
  });

  const data = integ.data;
  const isConfigured = !!data?.credentials_encrypted;
  const lastStatus = data?.last_sync_status ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">DN Trade інтеграція</CardTitle>
            {isConfigured && (
              <Badge variant="outline" className="border-success/40 text-success text-[10px]">
                <ShieldCheck className="mr-1 h-3 w-3" /> підключено
              </Badge>
            )}
          </div>
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
          . Згенеруйте ApiKey у{" "}
          <span className="font-mono text-foreground">Опції → Інтеграції → API DNTrade</span> і
          вставте сюди.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dntrade-key" className="text-xs">
            DN Trade ApiKey
          </Label>
          <div className="flex gap-2">
            <Input
              id="dntrade-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="вставте токен"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowKey((s) => !s)}
            >
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
            Перевірити та зберегти
          </Button>
        </div>

        {isConfigured && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => sync.mutate(false)}
                disabled={sync.isPending}
              >
                {sync.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                Синхронізувати зміни
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => sync.mutate(true)}
                disabled={sync.isPending}
              >
                Повна синхронізація
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Товари" value={data?.synced_products_count ?? 0} />
              <Stat label="Клієнти" value={data?.synced_customers_count ?? 0} />
              <Stat label="Замовлення" value={data?.synced_orders_count ?? 0} />
            </div>

            <div className="text-xs text-muted-foreground">
              Останній sync:{" "}
              {data?.last_sync_at
                ? new Date(data.last_sync_at).toLocaleString()
                : "—"}{" "}
              · статус:{" "}
              <span
                className={
                  lastStatus === "success"
                    ? "text-success"
                    : lastStatus === "failed"
                      ? "text-destructive"
                      : "text-foreground"
                }
              >
                {lastStatus ?? "—"}
              </span>
              {data?.last_sync_error && (
                <div className="mt-1 text-destructive">
                  {data.last_sync_error.slice(0, 200)}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Автосинхронізація — щогодини. Кнопка вище — миттєвий запуск.
            </p>
          </div>
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
