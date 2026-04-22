/**
 * Outreach Hunter — порт з Basic Food, multi-tenant edition.
 * Рендериться як набір вкладок усередині Lead Radar.
 *
 * Канали: Reddit, Google, Telegram, Instagram + спільний composer/executor.
 * Кнопки запускають серверні агенти (POST /hooks/agents/outreach-*).
 */
import { useMemo, useState } from "react";
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
  Play,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
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
import { friendlyAgentSummary, friendlyAgentError, agentLabel } from "@/lib/outreach/agentSummary";

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
  { id: "outreach-reddit-hunter", label: "Reddit пошук", icon: Search, tone: "default" },
  { id: "outreach-google-hunter", label: "Google пошук", icon: Globe, tone: "default" },
  { id: "outreach-telegram-hunter", label: "Telegram пошук", icon: MessageSquare, tone: "default" },
  { id: "outreach-instagram-hunter", label: "Instagram пошук", icon: Instagram, tone: "default" },
] as const;

const PIPELINE = [
  { id: "outreach-composer", label: "Composer (драфти)", icon: Wand2 },
  { id: "outreach-quality-scorer", label: "Quality scorer", icon: Sparkles },
  { id: "outreach-roi-collector", label: "ROI collector", icon: CheckCircle2 },
  { id: "outreach-self-heal", label: "Self-heal", icon: Shield },
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
function useRunAgent() {
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
        body: JSON.stringify({}),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(json.error ?? `HTTP ${r.status}`));
      return { agent, payload: json } as { agent: string; payload: unknown };
    },
    onSuccess: ({ agent, payload }) => {
      toast.success(`${agentLabel(agent)} відпрацював`, {
        description: friendlyAgentSummary(agent, payload),
      });
      qc.invalidateQueries({ queryKey: ["outreach-leads"] });
      qc.invalidateQueries({ queryKey: ["outreach-actions"] });
      qc.invalidateQueries({ queryKey: ["outreach-metrics"] });
    },
    onError: (e: Error) =>
      toast.error("Не вдалося запустити агента", { description: friendlyAgentError(e.message) }),
  });
}

// ───────── ВКЛАДКА: leads ─────────
export function OutreachLeadsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const runAgent = useRunAgent();

  const leads = useQuery({
    queryKey: ["outreach-leads", statusFilter, channelFilter],
    queryFn: async () => {
      let q = supabase
        .from("outreach_leads")
        .select(
          "id, tenant_id, channel, source_url, source_platform_id, author_handle, title, content, language, intent_score, matched_keywords, status, fingerprint, discovered_at",
        )
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {HUNTERS.map((h) => {
          const Icon = h.icon;
          return (
            <Button
              key={h.id}
              size="sm"
              variant="outline"
              disabled={runAgent.isPending}
              onClick={() => runAgent.mutate(h.id)}
            >
              {runAgent.isPending && runAgent.variables === h.id ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="mr-1.5 h-3.5 w-3.5" />
              )}
              {h.label}
            </Button>
          );
        })}
      </div>

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
            {LEAD_STATUSES.map((s) => (
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
              </button>
            ))}
            <Input
              placeholder="Пошук по тексту, автору, тегу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["outreach-leads"] })}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Оновити
            </Button>
          </div>
        </CardContent>
      </Card>

      {leads.isLoading ? (
        <Skeleton className="h-48" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Поки що немає лідів. Запустіть будь-який пошуковий агент вище.
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
      qc.invalidateQueries({ queryKey: ["outreach-leads"] });
      qc.invalidateQueries({ queryKey: ["outreach-actions"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (next: string) => {
    setBusy(true);
    const { error } = await supabase
      .from("outreach_leads")
      .update({ status: next })
      .eq("id", lead.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Статус оновлено");
      qc.invalidateQueries({ queryKey: ["outreach-leads"] });
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
          disabled={busy || lead.status === "acted"}
          onClick={runComposerForLead}
        >
          <Wand2 className="mr-1 h-3.5 w-3.5" />
          Згенерувати драфт
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || lead.status === "rejected"}
          onClick={() => updateStatus("rejected")}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Відхилити
        </Button>
      </div>
    </div>
  );
}

// ───────── ВКЛАДКА: actions ─────────
export function OutreachActionsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const runAgent = useRunAgent();

  const actions = useQuery({
    queryKey: ["outreach-actions", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("outreach_actions")
        .select(
          "id, tenant_id, lead_id, channel, action_type, draft_text, draft_alt_text, utm_campaign, promo_code, landing_url, status, posted_at, posted_url, failed_reason, retry_count, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as OutreachAction[];
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PIPELINE.map((p) => {
          const Icon = p.icon;
          return (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              disabled={runAgent.isPending}
              onClick={() => runAgent.mutate(p.id)}
            >
              {runAgent.isPending && runAgent.variables === p.id ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="mr-1.5 h-3.5 w-3.5" />
              )}
              {p.label}
            </Button>
          );
        })}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {ACTION_STATUSES.map((s) => (
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
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["outreach-actions"] })}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Оновити
          </Button>
        </CardContent>
      </Card>

      {actions.isLoading ? (
        <Skeleton className="h-48" />
      ) : (actions.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Немає драфтів. Спочатку запустіть пошуковий агент, потім Composer.
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
    const { error } = await supabase
      .from("outreach_actions")
      .update({ status: next })
      .eq("id", action.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Статус оновлено");
      qc.invalidateQueries({ queryKey: ["outreach-actions"] });
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
      qc.invalidateQueries({ queryKey: ["outreach-actions"] });
      qc.invalidateQueries({ queryKey: ["outreach-leads"] });
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
        <a href={action.landing_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
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
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("approved")}>
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
  const qc = useQueryClient();

  const metrics = useQuery({
    queryKey: ["outreach-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outreach_metrics")
        .select(
          "id, tenant_id, action_id, lead_id, channel, utm_campaign, promo_code, visits, signups, orders, revenue_cents, recorded_at",
        )
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["outreach-metrics"] })}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Оновити
        </Button>
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
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Outreach Hunter</h2>
          <p className="text-xs text-muted-foreground">
            Шукаємо людей з купівельним наміром у відкритих джерелах і пишемо корисні відповіді.
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
      </Tabs>
    </div>
  );
}
