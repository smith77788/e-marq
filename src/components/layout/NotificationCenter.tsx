/**
 * NotificationCenter — bell icon in the header with a dropdown inbox.
 *
 * Reads from `public.owner_notifications` for tenants the current user is a
 * member of. Realtime-subscribes to INSERT events to bump the unread badge
 * without polling. Lets users:
 *   - filter by All / Unread
 *   - mark a single notification as read (or just click the link)
 *   - mark all as read
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  CheckCheck,
  Lightbulb,
  HeartPulse,
  TriangleAlert,
  Info,
  Loader2,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type NotifRow = {
  id: string;
  tenant_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const PAGE_SIZE = 30;

function severityIcon(severity: string, kind: string) {
  if (kind === "insight") return <Lightbulb className="h-4 w-4 text-primary" />;
  if (severity === "high" || severity === "critical")
    return <HeartPulse className="h-4 w-4 text-destructive" />;
  if (severity === "warning") return <TriangleAlert className="h-4 w-4 text-warning" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function formatRelative(iso: string, lang: string) {
  const isUk = lang === "uk";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return isUk ? "щойно" : "just now";
  if (min < 60) return isUk ? `${min} хв тому` : `${min}m ago`;
  if (hr < 24) return isUk ? `${hr} год тому` : `${hr}h ago`;
  if (day < 7) return isUk ? `${day} дн тому` : `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationCenter() {
  const { t, lang } = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [marking, setMarking] = useState(false);

  // Tenants visible to user (drives RLS read scope)
  const { data: tenantIds = [] } = useQuery({
    queryKey: ["nc-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.tenant_id);
    },
    staleTime: 60_000,
  });

  const { data: notifs = [], isLoading } = useQuery({
    queryKey: ["nc-notifs", tenantIds.join(","), filter],
    enabled: tenantIds.length > 0,
    queryFn: async () => {
      let q = supabase
        .from("owner_notifications")
        .select("id, tenant_id, kind, severity, title, body, link, is_read, created_at")
        .in("tenant_id", tenantIds)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (filter === "unread") q = q.eq("is_read", false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NotifRow[];
    },
    refetchOnWindowFocus: true,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["nc-unread", tenantIds.join(",")],
    enabled: tenantIds.length > 0,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("owner_notifications")
        .select("id", { count: "exact", head: true })
        .in("tenant_id", tenantIds)
        .eq("is_read", false);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });

  // Realtime: bump cache on new INSERTs
  useEffect(() => {
    if (tenantIds.length === 0) return;
    const ch = supabase
      .channel("nc-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "owner_notifications" },
        (payload) => {
          const row = payload.new as { tenant_id: string };
          if (!tenantIds.includes(row.tenant_id)) return;
          void qc.invalidateQueries({ queryKey: ["nc-notifs"] });
          void qc.invalidateQueries({ queryKey: ["nc-unread"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantIds, qc]);

  async function markRead(id: string) {
    const { error } = await supabase
      .from("owner_notifications")
      .update({ is_read: true })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["nc-notifs"] }),
      qc.invalidateQueries({ queryKey: ["nc-unread"] }),
    ]);
  }

  async function markAllRead() {
    if (tenantIds.length === 0 || unreadCount === 0) return;
    setMarking(true);
    try {
      const { error } = await supabase
        .from("owner_notifications")
        .update({ is_read: true })
        .in("tenant_id", tenantIds)
        .eq("is_read", false);
      if (error) throw error;
      toast.success(t("notif.markedAll"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["nc-notifs"] }),
        qc.invalidateQueries({ queryKey: ["nc-unread"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setMarking(false);
    }
  }

  const badge = useMemo(() => {
    if (unreadCount <= 0) return null;
    return unreadCount > 99 ? "99+" : String(unreadCount);
  }, [unreadCount]);

  const triggerLabel =
    unreadCount > 0
      ? `${t("notif.title")} — ${unreadCount} ${t("notif.tabUnread").toLowerCase()}`
      : t("notif.title");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative h-9 w-9"
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {badge && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
            >
              {badge}
            </span>
          )}
          {/* Polite live region — screen readers announce when unread count changes */}
          <span aria-live="polite" aria-atomic="true" className="sr-only">
            {unreadCount > 0
              ? `${unreadCount} ${t("notif.tabUnread").toLowerCase()}`
              : t("notif.empty")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] p-0 sm:w-[400px]"
        aria-label={t("notif.title")}
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{t("notif.title")}</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {unreadCount}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={marking || unreadCount === 0}
            onClick={() => void markAllRead()}
          >
            {marking ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <CheckCheck className="mr-1 h-3 w-3" />
            )}
            {t("notif.markAll")}
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | "unread")}>
          <TabsList className="mx-3 mt-2 grid h-8 w-[calc(100%-1.5rem)] grid-cols-2">
            <TabsTrigger value="unread" className="text-xs">
              {t("notif.tabUnread")}
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs">
              {t("notif.tabAll")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ScrollArea className="h-[420px]">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : notifs.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40" />
              <p>{filter === "unread" ? t("notif.emptyUnread") : t("notif.empty")}</p>
            </div>
          ) : (
            <ul className="divide-y" role="list" aria-label={t("notif.title")}>
              {notifs.map((n) => {
                const item = (
                  <div
                    className={cn(
                      "flex gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50",
                      !n.is_read && "bg-primary/5",
                    )}
                  >
                    <div className="mt-0.5 shrink-0">{severityIcon(n.severity, n.kind)}</div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm",
                          !n.is_read ? "font-semibold text-foreground" : "text-foreground/90",
                        )}
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                      )}
                      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {formatRelative(n.created_at, lang)}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                );

                return (
                  <li key={n.id}>
                    {n.link ? (
                      <a
                        href={n.link}
                        className="block"
                        onClick={() => {
                          setOpen(false);
                          if (!n.is_read) void markRead(n.id);
                        }}
                      >
                        {item}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() => {
                          if (!n.is_read) void markRead(n.id);
                        }}
                      >
                        {item}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
