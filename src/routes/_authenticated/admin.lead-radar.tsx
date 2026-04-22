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
import { friendlyAgentSummary, friendlyAgentError, agentLabel } from "@/lib/outreach/agentSummary";

export const Route = createFileRoute("/_authenticated/admin/lead-radar")({
  component: LeadRadarPage,
});

type Prospect = {
  id: string;
  source: string;
  source_query: string | null;
  name: string;
  website_url: string | null;
  instagram_handle: string | null;
  email: string | null;
  niche: string | null;
  estimated_size: string | null;
  fit_score: number;
  signals: Record<string, unknown>;
  status: string;
  notes: string | null;
  last_contacted_at: string | null;
  created_at: string;
};

type Outreach = {
  id: string;
  prospect_id: string;
  channel: string;
  intent: string;
  status: string;
  payload: Record<string, unknown>;
  sent_at: string | null;
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
  "discovered",
  "qualified",
  "engaging",
  "converted",
  "rejected",
  "unreachable",
] as const;
const STATUS_LABEL: Record<string, string> = {
  all: "усі",
  discovered: "знайдені",
  qualified: "відібрані",
  engaging: "у роботі",
  converted: "стали клієнтами",
  rejected: "відхилені",
  unreachable: "не вдалось зв'язатись",
};
const STATUS_TONE: Record<string, string> = {
  discovered: "border-info/40 text-info",
  qualified: "border-primary/40 text-primary",
  engaging: "border-warning/40 text-warning",
  converted: "border-success/40 text-success",
  rejected: "border-muted-foreground/40 text-muted-foreground",
  unreachable: "border-destructive/40 text-destructive",
};

function LeadRadarPage() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) return <Skeleton className="h-48" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <Content />;
}

function Content() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);

  const prospects = useQuery({
    queryKey: ["lead-prospects", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("lead_prospects")
        .select(
          "id, source, source_query, name, website_url, instagram_handle, email, niche, estimated_size, fit_score, signals, status, notes, last_contacted_at, created_at",
        )
        .order("fit_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Prospect[];
    },
  });

  const magnets = useQuery({
    queryKey: ["lead-magnets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_magnets")
        .select("id, slug, title, topic, views_count, signups_attributed, is_published, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Magnet[];
    },
  });

  const outreach = useQuery({
    queryKey: ["lead-outreach"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_outreach")
        .select("id, prospect_id, channel, intent, status, payload, sent_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Outreach[];
    },
  });

  const runAgent = useMutation({
    mutationFn: async (agent: "web-prospector" | "social-engager" | "content-magnet") => {
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
      return { agent, payload: json };
    },
    onSuccess: ({ agent, payload }) => {
      toast.success(`${agentLabel(agent)} відпрацював`, {
        description: friendlyAgentSummary(agent, payload),
      });
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
      [r.name, r.website_url, r.instagram_handle, r.email, r.niche, r.source_query]
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
            onClick={() => runAgent.mutate("web-prospector")}
            className="w-full sm:w-auto"
          >
            {runAgent.isPending && runAgent.variables === "web-prospector" ? (
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
            onClick={() => runAgent.mutate("social-engager")}
            className="w-full sm:w-auto"
          >
            {runAgent.isPending && runAgent.variables === "social-engager" ? (
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
                    <ProspectRow key={p.id} prospect={p} />
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
              ) : (outreach.data?.length ?? 0) === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">Ще не було торкань.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(outreach.data ?? []).map((o) => (
                    <div key={o.id} className="px-4 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{o.channel}</Badge>
                        <Badge variant="secondary">{o.intent}</Badge>
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
                      {typeof o.payload?.subject === "string" && (
                        <p className="mt-1 text-foreground">{String(o.payload.subject)}</p>
                      )}
                      {typeof o.payload?.body === "string" && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {String(o.payload.body)}
                        </p>
                      )}
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

function ProspectRow({ prospect }: { prospect: Prospect }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const updateStatus = async (next: string) => {
    setBusy(true);
    const { error } = await supabase
      .from("lead_prospects")
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
    const r = await fetch(`/hooks/agents/social-engager`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ prospect_id: prospect.id }),
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
            <p className="truncate text-sm font-semibold text-foreground">{prospect.name}</p>
            <Badge variant="outline" className={STATUS_TONE[prospect.status] ?? "border-border"}>
              {STATUS_LABEL[prospect.status] ?? prospect.status}
            </Badge>
            <Badge
              variant="secondary"
              className="font-mono text-[10px]"
              title="Оцінка релевантності 0–100"
            >
              відповідність {prospect.fit_score}
            </Badge>
            {prospect.niche && (
              <Badge variant="outline" className="text-[10px]">
                {prospect.niche}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{prospect.source}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {prospect.website_url && (
              <a
                href={prospect.website_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {prospect.website_url}
              </a>
            )}
            {prospect.instagram_handle && (
              <a
                href={`https://instagram.com/${prospect.instagram_handle.replace(/^@/, "")}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                @{prospect.instagram_handle.replace(/^@/, "")}
              </a>
            )}
            {prospect.email && <span>✉ {prospect.email}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <Button size="sm" variant="ghost" disabled={busy} onClick={reachOut}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Написати
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => updateStatus("qualified")}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            Відібрати
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
