/**
 * Outreach Hunter — multi-tenant edition (2026 редакція).
 *
 * Покращення:
 *  - усі запити фільтруються по поточному тенанту (super-admin перемикає бренд через TenantSwitcher);
 *  - кнопка «Оновити» робить справжній refetch + показує крутилку та timestamp останнього оновлення;
 *  - auto-refresh раз на 60 сек, коли вкладка активна;
 *  - оптимістичне оновлення при відхиленні/підтвердженні (UI миттєво реагує);
 *  - bulk-дії: «Згенерувати драфти для всіх нових», «Відхилити всі видимі»;
 *  - лічильники по статусах прямо у фільтрах;
 *  - запуск hunter-агентів передає tenant_id у body, щоб скан був прицільний;
 *  - людський empty-state, який пояснює наступний крок.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Filter,
  Globe,
  Instagram,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { friendlyAgentSummary, friendlyAgentError, agentLabel } from "@/lib/outreach/agentSummary";
import { OutreachSettingsTab } from "@/components/admin/OutreachSettingsTab";

// ───────── Типи ─────────
type OutreachLead = {
  id: string;
  tenant_id: string;
  channel: string;
  source_url: string;
  source_platform_id: string | null;
  author_handle: string | null;
  title: string | null;
  content: string;
  language: string | null;
  intent_score: number;
  matched_keywords: string[];
  status: string;
  fingerprint: string;
  discovered_at: string;
};

type OutreachAction = {
  id: string;
  tenant_id: string;
  lead_id: string;
  channel: string;
  action_type: string;
  draft_text: string;
  draft_alt_text: string | null;
  utm_campaign: string;
  promo_code: string | null;
  landing_url: string;
  status: string;
  posted_at: string | null;
  posted_url: string | null;
  failed_reason: string | null;
  retry_count: number;
  created_at: string;
};

type OutreachMetric = {
  id: string;
  tenant_id: string;
  action_id: string;
  lead_id: string | null;
  channel: string;
  utm_campaign: string;
  promo_code: string | null;
  visits: number;
  signups: number;
  orders: number;
  revenue_cents: number;
  recorded_at: string;
};

const HUNTERS = [
  { id: "outreach-reddit-hunter", label: "Reddit пошук", icon: Search },
  { id: "outreach-google-hunter", label: "Google пошук", icon: Globe },
  { id: "outreach-telegram-hunter", label: "Telegram пошук", icon: MessageSquare },
  { id: "outreach-instagram-hunter", label: "Instagram пошук", icon: Instagram },
] as const;

const PIPELINE = [
  { id: "outreach-composer", label: "Composer (драфти)", icon: Wand2 },
  { id: "outreach-quality-scorer", label: "Оцінка якості", icon: Sparkles },
  { id: "outreach-roi-collector", label: "Збір ROI", icon: CheckCircle2 },
  { id: "outreach-self-heal", label: "Авто-відновлення", icon: Shield },
] as const;

const LEAD_STATUSES = [
  "all",
  "new",
  "composing",
  "queued",
  "acted",
  "rejected",
  "duplicate",
  "expired",
] as const;

const ACTION_STATUSES = [
  "all",
  "pending_review",
  "approved",
  "rejected",
  "posted",
  "failed",
  "skipped",
] as const;

const STATUS_LABEL_LEAD: Record<string, string> = {
  all: "усі",
  new: "новий",
  composing: "генерація",
  queued: "у черзі",
  acted: "виконано",
  rejected: "відхилено",
  duplicate: "дубль",
  expired: "застарілий",
};

const STATUS_LABEL_ACTION: Record<string, string> = {
  all: "усі",
  pending_review: "на перевірці",
  approved: "готовий до постингу",
  rejected: "відхилено",
  posted: "опубліковано",
  failed: "помилка",
  skipped: "пропущено",
};

const CHANNEL_LABEL: Record<string, string> = {
  reddit: "Reddit",
  google: "Google",
  blog: "Блоги",
  telegram: "Telegram",
  instagram: "Instagram",
  other: "Інше",
};

const STATUS_TONE_LEAD: Record<string, string> = {
  new: "border-info/40 text-info",
  composing: "border-warning/40 text-warning",
  queued: "border-primary/40 text-primary",
  acted: "border-success/40 text-success",
  rejected: "border-muted-foreground/40 text-muted-foreground",
  duplicate: "border-muted-foreground/40 text-muted-foreground",
  expired: "border-muted-foreground/40 text-muted-foreground",
};

const STATUS_TONE_ACTION: Record<string, string> = {
  pending_review: "border-warning/40 text-warning",
  approved: "border-info/40 text-info",
  rejected: "border-muted-foreground/40 text-muted-foreground",
  posted: "border-success/40 text-success",
  failed: "border-destructive/40 text-destructive",
  skipped: "border-muted-foreground/40 text-muted-foreground",
};

// ───────── HOOK: запуск агента ─────────
function useRunAgent(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agent: string) => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const r = await fetch(`/hooks/agents/${agent}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(tenantId ? { tenant_id: tenantId } : {}),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(json.error ?? `HTTP ${r.status}`));
      return { agent, payload: json } as { agent: string; payload: unknown };
    },
    onSuccess: ({ agent, payload }) => {
      toast.success(`${agentLabel(agent)} відпрацював`, {
        description: friendlyAgentSummary(agent, payload),
      });
      qc.invalidateQueries({ queryKey: ["outreach-leads"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-actions"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-metrics"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    },
    onError: (e: Error) =>
      toast.error("Не вдалося запустити агента", { description: friendlyAgentError(e.message) }),
  });
}

/** Кнопка справжнього refetch: показує спінер і час останнього оновлення. */
function RefreshButton({
  isFetching,
  dataUpdatedAt,
  onRefetch,
}: {
  isFetching: boolean;
  dataUpdatedAt: number;
  onRefetch: () => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // Force re-render every 30s so the relative timestamp stays fresh
  void tick;

  const ago = useMemo(() => {
    if (!dataUpdatedAt) return "ще не оновлювалось";
    const sec = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000));
    if (sec < 5) return "щойно";
    if (sec < 60) return `${sec} с тому`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} хв тому`;
    return `${Math.round(min / 60)} год тому`;
  }, [dataUpdatedAt, tick]);

  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground hidden sm:inline">Оновлено {ago}</span>
      <Button variant="outline" size="sm" onClick={onRefetch} disabled={isFetching}>
        {isFetching ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        Оновити
      </Button>
    </div>
  );
}

/** Спільний хук: лічильники по статусах для активного тенанту. */
function useStatusCounts(
  table: "outreach_leads" | "outreach_actions",
  tenantId: string | null,
  statuses: readonly string[],
) {
  return useQuery({
    queryKey: ["outreach-counts", table, tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const result: Record<string, number> = { all: 0 };
      const all = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId!);
      result.all = all.count ?? 0;
      await Promise.all(
        statuses
          .filter((s) => s !== "all")
          .map(async (s) => {
            const { count } = await supabase
              .from(table)
              .select("*", { count: "exact", head: true })
              .eq("tenant_id", tenantId!)
              .eq("status", s);
            result[s] = count ?? 0;
          }),
      );
      return result;
    },
  });
}

// ───────── ВКЛАДКА: leads ─────────
export function OutreachLeadsTab() {
  const qc = useQueryClient();
  const { currentTenantId, current } = useTenantContext();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const runAgent = useRunAgent(currentTenantId);
  const counts = useStatusCounts("outreach_leads", currentTenantId, LEAD_STATUSES);

  const leads = useQuery({
    queryKey: ["outreach-leads", currentTenantId, statusFilter, channelFilter],
    enabled: !!currentTenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("outreach_leads")
        .select(
          "id, tenant_id, channel, source_url, source_platform_id, author_handle, title, content, language, intent_score, matched_keywords, status, fingerprint, discovered_at",
        )
        .eq("tenant_id", currentTenantId!)
        .order("intent_score", { ascending: false })
        .order("discovered_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (channelFilter !== "all") q = q.eq("channel", channelFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as OutreachLead[];
    },
  });

  const filtered = useMemo(() => {
    const rows = leads.data ?? [];
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter((r) =>
      [r.title, r.content, r.author_handle, r.source_url, ...(r.matched_keywords ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [leads.data, search]);

  const bulkReject = async () => {
    const ids = filtered.filter((l) => l.status !== "rejected").map((l) => l.id);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("outreach_leads")
      .update({ status: "rejected" } as never)
      .in("id", ids);
    setBulkBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Відхилено ${ids.length}`);
      qc.invalidateQueries({ queryKey: ["outreach-leads"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    }
  };

  const bulkCompose = async () => {
    if (!currentTenantId) return;
    setBulkBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const r = await fetch(`/hooks/agents/outreach-composer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tenant_id: currentTenantId, limit: 25 }),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(json.error ?? `HTTP ${r.status}`));
      toast.success("Composer відпрацював", {
        description: friendlyAgentSummary("outreach-composer", json),
      });
      qc.invalidateQueries({ queryKey: ["outreach-leads"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-actions"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  if (!currentTenantId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Виберіть бренд у перемикачі вгорі — Outreach Hunter працює пер-тенантно.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hunter buttons */}
      <Card>
        <CardContent className="space-y-2 p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">
            Запустити пошук для бренду{" "}
            <span className="font-medium text-foreground">{current?.tenant_name ?? ""}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {HUNTERS.map((h) => {
              const Icon = h.icon;
              const busy = runAgent.isPending && runAgent.variables === h.id;
              return (
                <Button
                  key={h.id}
                  size="sm"
                  variant="outline"
                  disabled={runAgent.isPending}
                  onClick={() => runAgent.mutate(h.id)}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Icon className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {h.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Канал:</span>
            {["all", "reddit", "google", "telegram", "instagram", "blog"].map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  channelFilter === ch
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {ch === "all" ? "усі" : (CHANNEL_LABEL[ch] ?? ch)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Статус:</span>
            {LEAD_STATUSES.map((s) => {
              const n = counts.data?.[s] ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    statusFilter === s
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {STATUS_LABEL_LEAD[s] ?? s}
                  <span className="ml-1.5 text-[10px] opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Пошук по тексту, автору, тегу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={bulkCompose}>
              {bulkBusy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Згенерувати драфти для нових
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy || filtered.length === 0}
              onClick={bulkReject}
              className="text-muted-foreground"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Відхилити видимі
            </Button>
            <RefreshButton
              isFetching={leads.isFetching || counts.isFetching}
              dataUpdatedAt={leads.dataUpdatedAt}
              onRefetch={() => {
                void leads.refetch();
                void counts.refetch();
              }}
            />
          </div>
        </CardContent>
      </Card>

      {leads.isLoading ? (
        <Skeleton className="h-48" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-8 text-center text-sm text-muted-foreground">
            <p>Поки що немає лідів за обраними фільтрами.</p>
            <p className="text-xs">
              Натисніть один із пошукових агентів вище, або{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  setStatusFilter("all");
                  setChannelFilter("all");
                  setSearch("");
                }}
              >
                скиньте фільтри
              </button>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LeadRow({ lead }: { lead: OutreachLead }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const runComposerForLead = async () => {
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const r = await fetch(`/hooks/agents/outreach-composer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ lead_id: lead.id, tenant_id: lead.tenant_id }),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(json.error ?? `HTTP ${r.status}`));
      toast.success("Драфт згенеровано");
      qc.invalidateQueries({ queryKey: ["outreach-leads"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-actions"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (next: string) => {
    setBusy(true);
    // Optimistic update
    const prev = qc.getQueriesData<OutreachLead[]>({ queryKey: ["outreach-leads"] });
    qc.setQueriesData<OutreachLead[]>(
      { queryKey: ["outreach-leads"] },
      (old) => old?.map((l) => (l.id === lead.id ? { ...l, status: next } : l)) ?? old,
    );
    const { error } = await supabase
      .from("outreach_leads")
      .update({ status: next } as never)
      .eq("id", lead.id);
    setBusy(false);
    if (error) {
      // rollback
      for (const [key, value] of prev) qc.setQueryData(key, value);
      toast.error(error.message);
    } else {
      toast.success(next === "rejected" ? "Лід відхилено" : "Статус оновлено");
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-leads"], refetchType: "active" });
    }
  };

  const intentColor =
    lead.intent_score >= 0.7
      ? "border-success/40 text-success"
      : lead.intent_score >= 0.4
        ? "border-warning/40 text-warning"
        : "border-muted-foreground/40 text-muted-foreground";

  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{CHANNEL_LABEL[lead.channel] ?? lead.channel}</Badge>
        <Badge variant="outline" className={STATUS_TONE_LEAD[lead.status] ?? "border-border"}>
          {STATUS_LABEL_LEAD[lead.status] ?? lead.status}
        </Badge>
        <Badge variant="outline" className={`font-mono text-[10px] ${intentColor}`}>
          intent {lead.intent_score.toFixed(2)}
        </Badge>
        {lead.language && (
          <Badge variant="secondary" className="text-[10px]">
            {lead.language}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(lead.discovered_at).toLocaleString("uk-UA")}
        </span>
      </div>
      {lead.title && <p className="text-sm font-semibold text-foreground">{lead.title}</p>}
      <p className="line-clamp-3 text-sm text-muted-foreground">{lead.content}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {lead.author_handle && (
          <span className="text-muted-foreground">автор: {lead.author_handle}</span>
        )}
        <a
          href={lead.source_url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-primary hover:underline"
        >
          {lead.source_url}
        </a>
        {(lead.matched_keywords ?? []).slice(0, 5).map((k) => (
          <Badge key={k} variant="secondary" className="text-[10px]">
            {k}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || lead.status === "acted" || lead.status === "queued"}
          onClick={runComposerForLead}
        >
          <Wand2 className="mr-1 h-3.5 w-3.5" />
          Згенерувати драфт
        </Button>
        {lead.status !== "rejected" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => updateStatus("rejected")}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Відхилити
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus("new")}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Повернути
          </Button>
        )}
      </div>
    </div>
  );
}

// ───────── ВКЛАДКА: actions ─────────
export function OutreachActionsTab() {
  const qc = useQueryClient();
  const { currentTenantId } = useTenantContext();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const runAgent = useRunAgent(currentTenantId);
  const counts = useStatusCounts("outreach_actions", currentTenantId, ACTION_STATUSES);

  const actions = useQuery({
    queryKey: ["outreach-actions", currentTenantId, statusFilter],
    enabled: !!currentTenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("outreach_actions")
        .select(
          "id, tenant_id, lead_id, channel, action_type, draft_text, draft_alt_text, utm_campaign, promo_code, landing_url, status, posted_at, posted_url, failed_reason, retry_count, created_at",
        )
        .eq("tenant_id", currentTenantId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as OutreachAction[];
    },
  });

  const bulkApprove = async () => {
    const ids = (actions.data ?? []).filter((a) => a.status === "pending_review").map((a) => a.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("outreach_actions")
      .update({ status: "approved" } as never)
      .in("id", ids);
    if (error) toast.error(error.message);
    else {
      toast.success(`Підтверджено ${ids.length}`);
      qc.invalidateQueries({ queryKey: ["outreach-actions"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    }
  };

  if (!currentTenantId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Виберіть бренд у перемикачі вгорі.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
          {PIPELINE.map((p) => {
            const Icon = p.icon;
            const busy = runAgent.isPending && runAgent.variables === p.id;
            return (
              <Button
                key={p.id}
                size="sm"
                variant="outline"
                disabled={runAgent.isPending}
                onClick={() => runAgent.mutate(p.id)}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                )}
                {p.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {ACTION_STATUSES.map((s) => {
            const n = counts.data?.[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  statusFilter === s
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {STATUS_LABEL_ACTION[s] ?? s}
                <span className="ml-1.5 text-[10px] opacity-70">{n}</span>
              </button>
            );
          })}
          <Button
            size="sm"
            variant="outline"
            disabled={(counts.data?.pending_review ?? 0) === 0}
            onClick={bulkApprove}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> Підтвердити всі pending
          </Button>
          <RefreshButton
            isFetching={actions.isFetching || counts.isFetching}
            dataUpdatedAt={actions.dataUpdatedAt}
            onRefetch={() => {
              void actions.refetch();
              void counts.refetch();
            }}
          />
        </CardContent>
      </Card>

      {actions.isLoading ? (
        <Skeleton className="h-48" />
      ) : (actions.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Немає драфтів за обраним фільтром. Спочатку запустіть пошуковий агент, потім Composer.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(actions.data ?? []).map((a) => (
                <ActionRow key={a.id} action={a} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: OutreachAction }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [useAlt, setUseAlt] = useState(false);

  const setStatus = async (next: string) => {
    setBusy(true);
    const prev = qc.getQueriesData<OutreachAction[]>({ queryKey: ["outreach-actions"] });
    qc.setQueriesData<OutreachAction[]>(
      { queryKey: ["outreach-actions"] },
      (old) => old?.map((a) => (a.id === action.id ? { ...a, status: next } : a)) ?? old,
    );
    const { error } = await supabase
      .from("outreach_actions")
      .update({ status: next } as never)
      .eq("id", action.id);
    setBusy(false);
    if (error) {
      for (const [key, value] of prev) qc.setQueryData(key, value);
      toast.error(error.message);
    } else {
      toast.success(next === "rejected" ? "Драфт відхилено" : "Статус оновлено");
      qc.invalidateQueries({ queryKey: ["outreach-actions"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    }
  };

  const execute = async () => {
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const r = await fetch(`/hooks/agents/outreach-action-executor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          tenant_id: action.tenant_id,
          action_id: action.id,
          use_alt: useAlt,
        }),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(json.error ?? `HTTP ${r.status}`));
      toast.success("Виконано", { description: String(json.action ?? "") });
      qc.invalidateQueries({ queryKey: ["outreach-actions"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-leads"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["outreach-counts"], refetchType: "active" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const text = useAlt && action.draft_alt_text ? action.draft_alt_text : action.draft_text;

  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{CHANNEL_LABEL[action.channel] ?? action.channel}</Badge>
        <Badge variant="secondary" className="text-[10px]">
          {action.action_type}
        </Badge>
        <Badge variant="outline" className={STATUS_TONE_ACTION[action.status] ?? "border-border"}>
          {STATUS_LABEL_ACTION[action.status] ?? action.status}
        </Badge>
        {action.promo_code && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {action.promo_code}
          </Badge>
        )}
        {action.retry_count > 0 && (
          <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
            retry {action.retry_count}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(action.created_at).toLocaleString("uk-UA")}
        </span>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-2 text-sm text-foreground whitespace-pre-wrap">
        {text}
      </div>

      {action.draft_alt_text && (
        <button
          type="button"
          onClick={() => setUseAlt((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {useAlt ? "← Показати основний драфт" : "Показати альтернативний драфт →"}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <a
          href={action.landing_url}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          лендинг
        </a>
        <span>UTM: {action.utm_campaign}</span>
        {action.posted_url && (
          <a
            href={action.posted_url}
            target="_blank"
            rel="noreferrer"
            className="text-success hover:underline"
          >
            публікація
          </a>
        )}
        {action.failed_reason && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertCircle className="h-3 w-3" /> деталі помилки
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{action.failed_reason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {action.status === "pending_review" && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setStatus("approved")}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Підтвердити
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("rejected")}>
              <X className="mr-1 h-3.5 w-3.5" /> Відхилити
            </Button>
          </>
        )}
        {(action.status === "approved" || action.status === "failed") && (
          <Button size="sm" disabled={busy} onClick={execute}>
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 h-3.5 w-3.5" />
            )}
            Опублікувати
          </Button>
        )}
        {action.status === "rejected" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setStatus("pending_review")}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Повернути в pending
          </Button>
        )}
        {action.status === "posted" && (
          <Badge variant="outline" className="border-success/40 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> опубліковано
          </Badge>
        )}
      </div>
    </div>
  );
}

// ───────── ВКЛАДКА: ROI / metrics ─────────
export function OutreachMetricsTab() {
  const { currentTenantId } = useTenantContext();

  const metrics = useQuery({
    queryKey: ["outreach-metrics", currentTenantId],
    enabled: !!currentTenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outreach_metrics")
        .select(
          "id, tenant_id, action_id, lead_id, channel, utm_campaign, promo_code, visits, signups, orders, revenue_cents, recorded_at",
        )
        .eq("tenant_id", currentTenantId!)
        .order("recorded_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as OutreachMetric[];
    },
  });

  const totals = useMemo(() => {
    const rows = metrics.data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.visits += r.visits;
        acc.signups += r.signups;
        acc.orders += r.orders;
        acc.revenue_cents += r.revenue_cents;
        return acc;
      },
      { visits: 0, signups: 0, orders: 0, revenue_cents: 0 },
    );
  }, [metrics.data]);

  if (!currentTenantId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Виберіть бренд у перемикачі вгорі.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs text-muted-foreground">Візити</p>
            <p className="text-2xl font-bold">{totals.visits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs text-muted-foreground">Реєстрації</p>
            <p className="text-2xl font-bold">{totals.signups}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs text-muted-foreground">Замовлення</p>
            <p className="text-2xl font-bold">{totals.orders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs text-muted-foreground">Дохід, ₴</p>
            <p className="text-2xl font-bold">{(totals.revenue_cents / 100).toFixed(0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <RefreshButton
          isFetching={metrics.isFetching}
          dataUpdatedAt={metrics.dataUpdatedAt}
          onRefetch={() => void metrics.refetch()}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Атрибуція по UTM-кампаніях</CardTitle>
          <CardDescription>Що саме принесли драфти, які реально опублікувались.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {metrics.isLoading ? (
            <Skeleton className="h-32" />
          ) : (metrics.data?.length ?? 0) === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Поки немає метрик. ROI Collector збирає дані лише по опублікованих діях.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {(metrics.data ?? []).map((m) => (
                <div key={m.id} className="px-3 py-2 text-xs sm:px-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{CHANNEL_LABEL[m.channel] ?? m.channel}</Badge>
                    {m.promo_code && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {m.promo_code}
                      </Badge>
                    )}
                    <span className="font-mono text-muted-foreground">{m.utm_campaign}</span>
                    <span className="ml-auto text-muted-foreground">
                      {new Date(m.recorded_at).toLocaleString("uk-UA")}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-muted-foreground">
                    <span>👁 {m.visits}</span>
                    <span>✨ {m.signups}</span>
                    <span>🛒 {m.orders}</span>
                    <span>💰 {(m.revenue_cents / 100).toFixed(0)} ₴</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────── ОБ'ЄДНАНИЙ ВИВІД для Lead Radar ─────────
export function OutreachHunterSection() {
  const { current } = useTenantContext();
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Outreach Hunter</h2>
          <p className="text-xs text-muted-foreground">
            Шукаємо людей з купівельним наміром у відкритих джерелах і пишемо корисні відповіді
            {current ? (
              <>
                {" "}
                для бренду{" "}
                <span className="font-medium text-foreground">{current.tenant_name}</span>.
              </>
            ) : (
              "."
            )}
          </p>
        </div>
      </header>
      <Tabs defaultValue="leads">
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="leads" className="gap-1.5">
            <Search className="h-3.5 w-3.5" /> Знайдені дописи
          </TabsTrigger>
          <TabsTrigger value="actions" className="gap-1.5">
            <Send className="h-3.5 w-3.5" /> Драфти &amp; постинг
          </TabsTrigger>
          <TabsTrigger value="metrics" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> ROI
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Налаштування
          </TabsTrigger>
        </TabsList>
        <TabsContent value="leads" className="mt-4">
          <OutreachLeadsTab />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <OutreachActionsTab />
        </TabsContent>
        <TabsContent value="metrics" className="mt-4">
          <OutreachMetricsTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <OutreachSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
