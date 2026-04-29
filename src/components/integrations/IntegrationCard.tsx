/**
 * Картка одного джерела даних.
 * Показує: іконку, назву, опис, чесний статус, методи, що імпортує.
 * При кліку — відкриває wizard підключення.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { METHOD_LABELS, STATUS_LABELS, type IntegrationDef } from "@/lib/integrations/catalog";

type Props = {
  integration: IntegrationDef;
  isConnected?: boolean;
  canSync?: boolean;
  syncing?: boolean;
  /** ISO timestamp коли востаннє синхронізовано (з tenant_integrations.last_sync_at). */
  lastSyncAt?: string | null;
  /** Статус останньої синхронізації: completed | completed_with_errors | failed | running. */
  lastSyncStatus?: string | null;
  onSelect: (integration: IntegrationDef) => void;
  onSync?: (integration: IntegrationDef) => void;
};

const IMPORT_LABELS: Record<string, string> = {
  products: "товари",
  customers: "клієнти",
  orders: "замовлення",
  transactions: "транзакції",
  events: "події",
};

/** Humanized "5 хв тому" / "2 год тому" / "3 дні тому" / "щойно". */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "щойно";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "щойно";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год тому`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} дн. тому`;
  const mo = Math.floor(day / 30);
  return `${mo} міс. тому`;
}

export function IntegrationCard({
  integration,
  isConnected,
  canSync,
  syncing,
  lastSyncAt,
  lastSyncStatus,
  onSelect,
  onSync,
}: Props) {
  const Icon = integration.icon;
  const status = STATUS_LABELS[integration.status];
  const isComingSoon = integration.status === "comingSoon";
  const syncStale = lastSyncAt
    ? Date.now() - new Date(lastSyncAt).getTime() > 24 * 60 * 60 * 1000
    : false;
  const syncFailed =
    lastSyncStatus === "failed" || lastSyncStatus === "completed_with_errors";

  return (
    <Card
      className={cn(
        "group flex h-full flex-col transition-all hover:shadow-elegant",
        isConnected && "border-success/40 bg-success/5",
        isComingSoon && "opacity-80",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold leading-tight">{integration.name}</h3>
            <p className="text-xs text-muted-foreground">{METHOD_LABELS[integration.method]}</p>
          </div>
        </div>
        {isConnected && (
          <Badge className="border-success/40 bg-success/15 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            підключено
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-3 text-sm text-muted-foreground">{integration.description}</p>

        {isConnected && lastSyncAt && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-[11px]",
              syncFailed
                ? "text-destructive"
                : syncStale
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
            title={`Останній синк: ${new Date(lastSyncAt).toLocaleString("uk-UA")} · статус: ${lastSyncStatus ?? "—"}`}
          >
            {syncFailed ? (
              <AlertCircle className="h-3 w-3" />
            ) : syncStale ? (
              <Clock className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            <span>
              синк: {relativeTime(lastSyncAt)}
              {syncFailed && " · з помилками"}
              {!syncFailed && syncStale && " · давно"}
            </span>
          </div>
        )}
        {isConnected && !lastSyncAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-warning">
            <Clock className="h-3 w-3" />
            <span>ще не синхронізовано</span>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {integration.imports.map((imp) => (
            <span
              key={imp}
              className="rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {IMPORT_LABELS[imp] ?? imp}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Badge variant="outline" className={cn("text-[10px]", status.tone)}>
            {status.label}
          </Badge>
          <div className="flex gap-1">
            {isConnected && canSync && onSync && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSync(integration)}
                disabled={syncing}
                className="gap-1"
                title="Запустити імпорт зараз"
              >
                {syncing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Синк
              </Button>
            )}
            <Button
              size="sm"
              variant={isComingSoon ? "outline" : "default"}
              onClick={() => onSelect(integration)}
              className="gap-1"
            >
              {isComingSoon ? "Інструкція" : isConnected ? "Налаштувати" : "Підключити"}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
