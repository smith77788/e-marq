/**
 * DetailDrawer — universal shell that renders the active detail handle.
 *
 *  - Mobile (< 768px): vaul bottom sheet (90vh, drag-handle, swipe-down close)
 *  - Desktop: Radix Sheet (right side, width depends on size)
 *  - Loading: <DetailSkeleton />
 *  - Error: friendly error block with retry
 *  - Tabs: Огляд / Деталі / Лог / Дії
 *  - Esc / backdrop / X / swipe close → URL is cleaned
 *
 * Renders nothing when no handle is active.
 */
import * as React from "react";
import {
  AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, Info, Sparkles, X,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDetailController } from "./DetailController";
import { useDetailData } from "./useDetailData";
import { DetailSkeleton } from "./DetailSkeleton";
import { Sparkline } from "./Sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { DetailAction, DetailPayload, DrawerSize } from "./types";

const SIZE_TO_WIDTH: Record<DrawerSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md md:max-w-lg",
  lg: "sm:max-w-lg md:max-w-xl lg:max-w-2xl",
  fullscreen: "sm:max-w-none w-full",
};

function toneClasses(tone?: string) {
  switch (tone) {
    case "success": return "border-success/40 bg-success/10 text-success";
    case "warning": return "border-warning/40 bg-warning/10 text-warning-foreground";
    case "destructive": return "border-destructive/40 bg-destructive/10 text-destructive";
    case "primary": return "border-primary/40 bg-primary/10 text-primary";
    default: return "border-border bg-muted/40 text-foreground";
  }
}

function ActionButton({ action, onAfterRun }: { action: DetailAction; onAfterRun?: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const variant = action.variant === "primary"
    ? "default"
    : action.variant === "destructive"
      ? "destructive"
      : action.variant === "ghost"
        ? "ghost"
        : "secondary";

  if (action.href) {
    return (
      <Button asChild variant={variant} disabled={action.disabled} className="gap-1.5">
        <a href={action.href} target={action.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          {action.label}
          {action.href.startsWith("http") && <ExternalLink className="h-3.5 w-3.5" />}
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      disabled={action.disabled || busy}
      onClick={async () => {
        if (!action.onRun) return;
        try {
          setBusy(true);
          await action.onRun();
          onAfterRun?.();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : action.label}
    </Button>
  );
}

function LogIcon({ kind }: { kind?: string }) {
  if (kind === "success") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (kind === "warning") return <AlertTriangle className="h-4 w-4 text-warning-foreground" />;
  if (kind === "destructive") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function DetailBody({ data }: { data: DetailPayload }) {
  const series = data.timeseries?.map((p) => p.v) ?? [];
  const hasOverview =
    !!(data.metrics?.length || series.length || data.description || data.ai_insights?.length || data.media?.length);
  const hasDetails = !!(data.related_items?.length || (data.metadata && Object.keys(data.metadata).length));
  const hasLog = !!data.events_log?.length;
  const hasActions = !!data.actions?.length;

  // Default tab = first non-empty tab.
  const defaultTab = hasOverview ? "overview" : hasDetails ? "details" : hasLog ? "log" : "actions";

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="overview" disabled={!hasOverview}>Огляд</TabsTrigger>
        <TabsTrigger value="details" disabled={!hasDetails}>Деталі</TabsTrigger>
        <TabsTrigger value="log" disabled={!hasLog}>Лог</TabsTrigger>
        <TabsTrigger value="actions" disabled={!hasActions}>Дії</TabsTrigger>
      </TabsList>

      {/* ---------------- OVERVIEW ---------------- */}
      <TabsContent value="overview" className="mt-4 space-y-5">
        {data.metrics && data.metrics.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.metrics.map((m, i) => (
              <div
                key={i}
                className={cn("rounded-lg border p-3", toneClasses(m.tone))}
              >
                <p className="text-[10px] font-medium uppercase tracking-wider opacity-80">{m.label}</p>
                <p className="mt-1 text-lg font-bold leading-tight">{m.value}</p>
                {m.hint && <p className="mt-0.5 text-[11px] opacity-75">{m.hint}</p>}
              </div>
            ))}
          </div>
        )}

        {series.length > 1 && (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Тренд</p>
            <Sparkline data={series} />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{data.timeseries?.[0]?.t}</span>
              <span>{data.timeseries?.[data.timeseries.length - 1]?.t}</span>
            </div>
          </div>
        )}

        {data.media && data.media.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {data.media.map((m, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded-md border border-border bg-muted">
                {m.kind === "video" ? (
                  <video src={m.url} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  <img src={m.url} alt={m.alt ?? ""} className="h-full w-full object-cover" loading="lazy" />
                )}
              </div>
            ))}
          </div>
        )}

        {data.description && (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{data.description}</p>
          </div>
        )}

        {data.ai_insights && data.ai_insights.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI-інсайти
            </div>
            {data.ai_insights.map((ins) => (
              <div
                key={ins.id}
                className={cn("rounded-lg border p-3", toneClasses(ins.tone === "info" ? "primary" : ins.tone))}
              >
                <p className="text-sm font-medium">{ins.title}</p>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{ins.body}</p>
                {typeof ins.confidence === "number" && (
                  <p className="mt-1 text-[10px] opacity-70">Впевненість: {Math.round(ins.confidence * 100)}%</p>
                )}
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      {/* ---------------- DETAILS ---------------- */}
      <TabsContent value="details" className="mt-4 space-y-4">
        {data.metadata && Object.keys(data.metadata).length > 0 && (
          <div className="rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(data.metadata).map(([k, v]) => (
                  <tr key={k} className="border-b border-border last:border-0">
                    <td className="w-1/3 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</td>
                    <td className="px-3 py-2 text-foreground">{v === null ? "—" : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.related_items && data.related_items.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Повʼязані</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {data.related_items.map((r) => (
                <div
                  key={r.id}
                  className="min-w-[180px] shrink-0 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                    {r.badge && <Badge variant="outline" className="ml-2 text-[10px]">{r.badge}</Badge>}
                  </div>
                  {r.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.subtitle}</p>}
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{r.resourceType}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      {/* ---------------- LOG ---------------- */}
      <TabsContent value="log" className="mt-4">
        <ol className="space-y-2">
          {data.events_log?.map((ev) => (
            <li key={ev.id} className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
              <LogIcon kind={ev.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{ev.title}</p>
                  <time className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(ev.at).toLocaleString("uk-UA")}
                  </time>
                </div>
                {ev.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{ev.description}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </TabsContent>

      {/* ---------------- ACTIONS ---------------- */}
      <TabsContent value="actions" className="mt-4 space-y-2">
        {data.actions?.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{a.label}</p>
              {a.description && <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>}
            </div>
            <ActionButton action={a} />
          </div>
        ))}
      </TabsContent>
    </Tabs>
  );
}

function DetailContents() {
  const ctrl = useDetailController();
  const handle = ctrl.state.active;
  const query = useDetailData(handle);

  if (!handle) return null;

  const title = handle.drawerTitle ?? query.data?.title ?? "Деталі";
  const subtitle = query.data?.subtitle;
  const status = query.data?.status;

  // Pick first action with primary variant for the sticky footer (if any).
  const primaryAction = query.data?.actions?.find((a) => a.variant === "primary") ?? query.data?.actions?.[0];
  const secondaryAction = query.data?.actions?.find((a) => a !== primaryAction);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sticky header summary (status bar) */}
      {(subtitle || status) && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 sm:px-6">
          {status && (
            <Badge variant="outline" className={cn("text-[10px]", toneClasses(status.tone))}>
              {status.label}
            </Badge>
          )}
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      )}

      {/* Body */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-4 sm:px-6">
          {query.isLoading ? (
            <DetailSkeleton />
          ) : query.isError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-semibold text-destructive">Не вдалося завантажити деталі</p>
              <p className="mt-1 text-xs text-destructive/80">
                {(query.error as Error)?.message ?? "Невідома помилка"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => query.refetch()}
              >
                Спробувати ще
              </Button>
            </div>
          ) : query.data ? (
            <DetailBody data={query.data} />
          ) : (
            <p className="text-sm text-muted-foreground">Немає даних.</p>
          )}
          {/* spacer so content isn't hidden by sticky footer */}
          {primaryAction && <div className="h-16" />}
        </div>
      </ScrollArea>

      {/* Sticky footer */}
      {primaryAction && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
          {secondaryAction && secondaryAction !== primaryAction && (
            <ActionButton action={secondaryAction} />
          )}
          <ActionButton action={primaryAction} />
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">{title}</span>
        </div>
      )}
    </div>
  );
}

export function DetailDrawer() {
  const ctrl = useDetailController();
  const isMobile = useIsMobile();
  const handle = ctrl.state.active;
  const open = !!handle;
  const size: DrawerSize = handle?.drawerSize ?? "md";
  const title = handle?.drawerTitle ?? "Деталі";

  // Mobile: bottom sheet
  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(o) => {
          if (!o) ctrl.close();
        }}
      >
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="pr-8">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">Розширена деталь елементу</DrawerDescription>
            <button
              onClick={() => ctrl.close()}
              aria-label="Закрити"
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {open && <DetailContents />}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: right sheet
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) ctrl.close();
      }}
    >
      <SheetContent
        side="right"
        className={cn("flex w-full flex-col gap-0 p-0", SIZE_TO_WIDTH[size])}
      >
        <SheetHeader className="border-b border-border px-6 py-4 text-left">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          <SheetDescription className="sr-only">Розширена деталь елементу</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {open && <DetailContents />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
