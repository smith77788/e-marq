/**
 * Lead Radar — супер-адмін бачить всі знайдені бренди-кандидати,
 * запускає скан-агентів та керує статусами.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Filter,
  Globe,
  Instagram,
  Loader2,
  Magnet,
  Play,
  Radar,
  RefreshCw,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { OutreachHunterSection } from "@/components/admin/OutreachHunterTabs";
import { MagnetPreviewDialog } from "@/components/admin/MagnetPreviewDialog";
import { TelegramConnectCard } from "@/components/owner/TelegramConnectCard";
import { TelegramUserConnectCard } from "@/components/owner/TelegramUserConnectCard";
import { TelegramUserDmDialog } from "@/components/owner/TelegramUserDmDialog";
import { friendlyAgentSummary, friendlyAgentError, agentLabel } from "@/lib/outreach/agentSummary";

export const Route = createFileRoute("/_authenticated/admin/lead-radar")({
  component: LeadRadarPage,
});

type Prospect = {
  id: string;
  tenant_id: string;
  channel: string;
  source_url: string;
  author_handle: string | null;
  title: string | null;
  content: string;
  language: string | null;
  intent_score: number;
  matched_keywords: string[];
  status: string;
  discovered_at: string;
  created_at: string;
};

type Outreach = {
  id: string;
  tenant_id: string;
  lead_id: string;
  channel: string;
  action_type: string;
  status: string;
  draft_text: string;
  landing_url: string;
  promo_code: string | null;
  posted_url: string | null;
  failed_reason: string | null;
  created_at: string;
};

type Magnet = {
  id: string;
  slug: string;
  title: string;
  topic: string | null;
  views_count: number;
  signups_attributed: number;
  is_published: boolean;
  created_at: string;
};

const STATUSES = [
  "all",
  "new",
  "composing",
  "queued",
  "acted",
  "rejected",
  "duplicate",
  "expired",
] as const;
const STATUS_LABEL: Record<string, string> = {
  all: "усі",
  new: "нові",
  composing: "генерація",
  queued: "у черзі",
  acted: "оброблені",
  rejected: "відхилені",
  duplicate: "дублікати",
  expired: "застарілі",
};
const STATUS_TONE: Record<string, string> = {
  new: "border-info/40 text-info",
  composing: "border-warning/40 text-warning",
  queued: "border-primary/40 text-primary",
  acted: "border-success/40 text-success",
  rejected: "border-muted-foreground/40 text-muted-foreground",
  duplicate: "border-muted-foreground/40 text-muted-foreground",
  expired: "border-destructive/40 text-destructive",
};

function summarizeBatchResult(payload: Record<string, unknown>): string {
  const summary = (payload.summary ?? {}) as Record<string, unknown>;
  const tenants = Object.values(summary);
  const inserted = tenants.reduce<number>((sum, item) => {
    const stats = (item as { stats?: Record<string, unknown> })?.stats ?? {};
    return sum + (typeof stats.inserted === "number" ? stats.inserted : 0);
  }, 0);
  const candidates = tenants.reduce<number>((sum, item) => {
    const stats = (item as { stats?: Record<string, unknown> })?.stats ?? {};
    return sum + (typeof stats.candidates === "number" ? stats.candidates : 0);
  }, 0);
  return `Кандидатів: ${candidates}, нових лідів: ${inserted}.`;
}

function LeadRadarPage() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) return <Skeleton className="h-48" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <Content />;
}

function Content() {
  const qc = useQueryClient();
  const { currentTenantId, tenants } = useTenantContext();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);

  // Для super-admin без вибраного tenant'а — беремо перший доступний
  const telegramTenantId = currentTenantId ?? tenants[0]?.tenant_id ?? null;

  const prospects = useQuery({
    queryKey: ["lead-prospects", currentTenantId, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("outreach_leads")
        .select(
          "id, tenant_id, channel, source_url, author_handle, title, content, language, intent_score, matched_keywords, status, discovered_at, created_at",
        )
        .order("discovered_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (currentTenantId) q = q.eq("tenant_id", currentTenantId);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Prospect[];
    },
  });

  const magnets = useQuery({
    queryKey: ["lead-magnets", currentTenantId],
    queryFn: async () => {
      const q = supabase
        .from("lead_magnets")
        .select("id, slug, title, topic, views_count, signups_attributed, is_published, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Magnet[];
    },
  });

  const outreach = useQuery({
    queryKey: ["lead-outreach", currentTenantId],
    queryFn: async () => {
      let q = supabase
        .from("outreach_actions")
        .select(
          "id, tenant_id, lead_id, channel, action_type, status, draft_text, landing_url, promo_code, posted_url, failed_reason, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (currentTenantId) q = q.eq("tenant_id", currentTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Outreach[];
    },
  });

  const runAgent = useMutation({
    mutationFn: async (agent: "lead-radar-scan" | "lead-radar-compose" | "content-magnet") => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const payload = currentTenantId ? { tenant_id: currentTenantId } : {};
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      };

      if (agent === "lead-radar-scan") {
        const [googleRes, redditRes] = await Promise.all([
          fetch(`/hooks/agents/outreach-google-hunter`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          }),
          fetch(`/hooks/agents/outreach-reddit-hunter`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          }),
        ]);
        const google = (await googleRes.json().catch(() => ({}))) as Record<string, unknown>;
        const reddit = (await redditRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (!googleRes.ok) throw new Error(String(google.error ?? `HTTP ${googleRes.status}`));
        if (!redditRes.ok) throw new Error(String(reddit.error ?? `HTTP ${redditRes.status}`));
        return { agent, payload: { google, reddit } };
      }

      const route = agent === "lead-radar-compose" ? "outreach-composer" : agent;
      const r = await fetch(`/hooks/agents/${route}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(json.error ?? `HTTP ${r.status}`));
      return { agent, payload: json };
    },
    onSuccess: ({ agent, payload }) => {
      const description =
        agent === "lead-radar-scan"
          ? `${summarizeBatchResult((payload as { google: Record<string, unknown> }).google)} ${summarizeBatchResult((payload as { reddit: Record<string, unknown> }).reddit)}`
          : friendlyAgentSummary(
              agent === "lead-radar-compose" ? "outreach-composer" : agent,
              payload,
            );
      toast.success(
        agent === "lead-radar-scan"
          ? "Google та Reddit hunter відпрацювали"
          : `${agentLabel(agent === "lead-radar-compose" ? "outreach-composer" : agent)} відпрацював`,
        { description },
      );
      qc.invalidateQueries({ queryKey: ["lead-prospects"] });
      qc.invalidateQueries({ queryKey: ["lead-magnets"] });
      qc.invalidateQueries({ queryKey: ["lead-outreach"] });
    },
    onError: (e: Error) =>
      toast.error("Не вдалося запустити агента", { description: friendlyAgentError(e.message) }),
  });

  const filteredProspects = useMemo(() => {
    const rows = prospects.data ?? [];
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter((r) =>
      [r.title, r.content, r.author_handle, r.source_url, ...(r.matched_keywords ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [prospects.data, search]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Radar className="h-5 w-5 text-primary-foreground" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Lead Radar</h1>
            <p className="text-sm text-muted-foreground">
              Агенти знаходять бренди в інтернеті та залучають їх до MARQ.
            </p>
          </div>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Button
            size="sm"
            variant="outline"
            disabled={runAgent.isPending}
            onClick={() => runAgent.mutate("lead-radar-scan")}
            className="w-full sm:w-auto"
          >
            {runAgent.isPending && runAgent.variables === "lead-radar-scan" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Globe className="mr-1.5 h-3.5 w-3.5" />
            )}
            Знайти бренди в інтернеті
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={runAgent.isPending}
            onClick={() => runAgent.mutate("lead-radar-compose")}
            className="w-full sm:w-auto"
          >
            {runAgent.isPending && runAgent.variables === "lead-radar-compose" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Instagram className="mr-1.5 h-3.5 w-3.5" />
            )}
            Підготувати листи
          </Button>
          <Button
            size="sm"
            disabled={runAgent.isPending}
            onClick={() => runAgent.mutate("content-magnet")}
            className="w-full sm:w-auto"
          >
            {runAgent.isPending && runAgent.variables === "content-magnet" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Magnet className="mr-1.5 h-3.5 w-3.5" />
            )}
            Згенерувати SEO-сторінки
          </Button>
        </div>
      </header>

      {telegramTenantId && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TelegramConnectCard tenantId={telegramTenantId} />
          <TelegramUserConnectCard tenantId={telegramTenantId} />
        </div>
      )}

      <Tabs defaultValue="prospects">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="prospects" className="gap-1.5 text-xs">
            <Target className="h-3.5 w-3.5" /> Кандидати
          </TabsTrigger>
          <TabsTrigger value="outreach" className="gap-1.5 text-xs">
            <Send className="h-3.5 w-3.5" /> Звернення
          </TabsTrigger>
          <TabsTrigger value="magnets" className="gap-1.5 text-xs">
            <Magnet className="h-3.5 w-3.5" /> Контент-магніти
          </TabsTrigger>
          <TabsTrigger value="hunter" className="gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" /> Глибокий пошук
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prospects" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {STATUSES.map((s) => (
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
                {STATUS_LABEL[s] ?? s}
              </button>
            ))}
            <Input
              placeholder="Пошук…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["lead-prospects"] })}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Оновити
            </Button>
          </div>

          {prospects.isLoading ? (
            <Skeleton className="h-48" />
          ) : prospects.isError ? (
            <p className="p-6 text-sm text-destructive">
              Не вдалося завантажити.{" "}
              <button type="button" className="underline" onClick={() => void prospects.refetch()}>
                Повторити
              </button>
            </p>
          ) : filteredProspects.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Поки що порожньо. Запустіть Web Prospector, щоб знайти перших кандидатів.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {filteredProspects.map((p) => (
                    <ProspectRow key={p.id} prospect={p} tenantId={telegramTenantId} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="outreach" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Останні дії outreach</CardTitle>
              <CardDescription>Як саме агенти вже звертались до знайдених брендів.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {outreach.isLoading ? (
                <Skeleton className="h-32" />
              ) : outreach.isError ? (
                <p className="p-6 text-sm text-destructive">
                  Не вдалося завантажити.{" "}
                  <button type="button" className="underline" onClick={() => void outreach.refetch()}>
                    Повторити
                  </button>
                </p>
              ) : (outreach.data?.length ?? 0) === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">Ще не було торкань.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(outreach.data ?? []).map((o) => (
                    <div key={o.id} className="px-4 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{o.channel}</Badge>
                        <Badge variant="secondary">{o.action_type}</Badge>
                        <Badge
                          variant="outline"
                          className={
                            o.status === "sent"
                              ? "border-success/40 text-success"
                              : o.status === "replied"
                                ? "border-primary/40 text-primary"
                                : "border-info/40 text-info"
                          }
                        >
                          {o.status}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(o.created_at).toLocaleString("uk-UA")}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-foreground">{o.draft_text}</p>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <a
                          href={o.landing_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          лендинг
                        </a>
                        {o.promo_code && <span>promo: {o.promo_code}</span>}
                        {o.posted_url && (
                          <a
                            href={o.posted_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-success hover:underline"
                          >
                            публікація
                          </a>
                        )}
                        {o.failed_reason && (
                          <span className="text-destructive">{o.failed_reason}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="magnets" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Контент-магніти</CardTitle>
              <CardDescription>
                Безкоштовні SEO-сторінки з лідогенерацією. Доступні за <code>/m/&lt;slug&gt;</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {magnets.isLoading ? (
                <Skeleton className="h-32" />
              ) : magnets.isError ? (
                <p className="p-6 text-sm text-destructive">
                  Не вдалося завантажити.{" "}
                  <button type="button" className="underline" onClick={() => void magnets.refetch()}>
                    Повторити
                  </button>
                </p>
              ) : (magnets.data?.length ?? 0) === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  Поки порожньо. Запустіть Content Magnet — він згенерує початковий пакет.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {(magnets.data ?? []).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPreviewSlug(m.slug)}
                      className="block w-full text-left px-4 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            /m/{m.slug} · {m.topic ?? "general"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>👁 {m.views_count}</span>
                          <span>✨ {m.signups_attributed}</span>
                          {!m.is_published && (
                            <Badge variant="outline" className="text-[10px]">
                              draft
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hunter" className="mt-4">
          <OutreachHunterSection />
        </TabsContent>
      </Tabs>

      <MagnetPreviewDialog
        slug={previewSlug}
        open={previewSlug !== null}
        onOpenChange={(v) => !v && setPreviewSlug(null)}
      />
    </div>
  );
}

function ProspectRow({ prospect, tenantId }: { prospect: Prospect; tenantId: string | null }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const updateStatus = async (next: string) => {
    setBusy(true);
    const { error } = await supabase
      .from("outreach_leads")
      .update({ status: next })
      .eq("id", prospect.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Статус оновлено");
      qc.invalidateQueries({ queryKey: ["lead-prospects"] });
    }
  };

  const reachOut = async () => {
    setBusy(true);
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      setBusy(false);
      toast.error("Авторизуйтеся");
      return;
    }
    const r = await fetch(`/hooks/agents/outreach-composer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tenant_id: prospect.tenant_id, lead_id: prospect.id }),
    });
    setBusy(false);
    if (!r.ok) toast.error("Помилка outreach");
    else {
      toast.success("Заплановано торкання");
      qc.invalidateQueries({ queryKey: ["lead-prospects"] });
      qc.invalidateQueries({ queryKey: ["lead-outreach"] });
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {prospect.title ?? prospect.author_handle ?? prospect.source_url}
            </p>
            <Badge variant="outline" className={STATUS_TONE[prospect.status] ?? "border-border"}>
              {STATUS_LABEL[prospect.status] ?? prospect.status}
            </Badge>
            <Badge
              variant="secondary"
              className="font-mono text-[10px]"
              title="Оцінка релевантності 0–100"
            >
              intent {(prospect.intent_score * 100).toFixed(0)}
            </Badge>
            {prospect.language && (
              <Badge variant="outline" className="text-[10px]">
                {prospect.language}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{prospect.channel}</span>
          </div>
          <p className="line-clamp-3 text-sm text-muted-foreground">{prospect.content}</p>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <a
              href={prospect.source_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {prospect.source_url}
            </a>
            {prospect.author_handle && <span>автор: {prospect.author_handle}</span>}
            {(prospect.matched_keywords ?? []).slice(0, 5).map((keyword) => (
              <Badge key={keyword} variant="secondary" className="text-[10px]">
                {keyword}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <Button size="sm" variant="ghost" disabled={busy} onClick={reachOut}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Написати
          </Button>
          <TelegramUserDmDialog
            tenantId={tenantId}
            prospectId={prospect.id}
            prospectName={prospect.title ?? prospect.author_handle ?? "лід"}
            defaultPeer={
              prospect.author_handle ? `@${prospect.author_handle.replace(/^@/, "")}` : ""
            }
            defaultText={`Привіт! Побачив ваш запит${prospect.title ? ` «${prospect.title}»` : ""} — у MARQ є кілька ідей, що можуть зекономити години ручної роботи. Цікаво коротко обмінятись?`}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => updateStatus("queued")}
          >
            <Play className="mr-1 h-3.5 w-3.5" />У чергу
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => updateStatus("rejected")}
            aria-label="Відхилити лід"
          >
            <span aria-hidden="true">✕</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
