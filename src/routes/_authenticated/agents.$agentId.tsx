/**
 * Agent deep-dive — single agent's profile, recent runs, applied actions,
 * and permissions configuration. Reachable from the Agent Library or any
 * timeline tooltip.
 */
import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { uk, enUS } from "date-fns/locale";
import {
  ArrowLeft,
  Activity,
  Loader2,
  PlayCircle,
  Sparkles,
  Bot,
  Boxes,
  ShoppingCart,
  Search,
  Tag,
  Mail,
  Brain,
  Shield,
  Truck,
  Coins,
  Bell,
  BarChart3,
  Megaphone,
  Zap,
  Users,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useT, tStatic, type TKey } from "@/lib/i18n";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { getAgentMeta, type AgentMeta } from "@/lib/acos/agentCatalog";
import { humanizeAgentId } from "@/lib/acos/agentLabels";
import { AgentPermissionsCard } from "@/components/owner/AgentPermissionsCard";
import { useSubscriptionGate } from "@/hooks/useSubscriptionGate";
import { useAuth } from "@/hooks/useAuth";
import { AgentsPaywall } from "@/components/owner/AgentsPaywall";

export const Route = createFileRoute("/_authenticated/agents/$agentId")({
  head: () => ({
    meta: [
      { title: tStatic("ag.cab.libTitle") },
      { name: "description", content: tStatic("ag.cab.libDesc") },
    ],
  }),
  component: AgentDetailPage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>{tStatic("ag.cab.notFound")}</CardTitle>
          <CardDescription>{error.message}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>{tStatic("ag.cab.notFound")}</CardTitle>
          <CardDescription>{tStatic("ag.cab.notFoundDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/agents/library">{tStatic("ag.cab.back")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  ),
});

const ICON_MAP: Record<AgentMeta["icon"], typeof Bot> = {
  Users,
  Boxes,
  ShoppingCart,
  Search,
  Tag,
  Mail,
  Bot,
  Brain,
  Sparkles,
  Shield,
  Truck,
  Coins,
  Activity,
  Bell,
  BarChart3,
  Megaphone,
  Zap,
};

type RunRow = {
  id: string;
  status: string;
  insights_created: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type ActionRow = {
  id: string;
  action_type: string;
  status: string;
  applied_at: string | null;
  expected_impact: string | null;
};

function AgentDetailPage() {
  const { agentId } = useParams({ from: "/_authenticated/agents/$agentId" });
  const meta = getAgentMeta(agentId);
  if (!meta) throw notFound();

  const { t, lang } = useT();
  const { current, loading: tenantLoading } = useTenantContext();
  const { isSuperAdmin } = useAuth();
  const tenantId = current?.tenant_id ?? null;
  const gate = useSubscriptionGate(tenantId);
  const showPaywall = !isSuperAdmin && !!tenantId && !gate.loading && !gate.hasAccess;
  const [running, setRunning] = useState(false);

  const fourteenDaysAgo = useMemo(
    () => new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const { data: runs = [], isLoading: runsLoading } = useQuery<RunRow[]>({
    queryKey: ["agent-detail-runs", tenantId, agentId, fourteenDaysAgo],
    enabled: Boolean(tenantId),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acos_agent_runs")
        .select("id, status, insights_created, started_at, finished_at, error")
        .eq("tenant_id", tenantId!)
        .eq("agent_id", agentId)
        .gte("started_at", fourteenDaysAgo)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as RunRow[];
    },
  });

  const { data: actions = [] } = useQuery<ActionRow[]>({
    queryKey: ["agent-detail-actions", tenantId, agentId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_actions")
        .select("id, action_type, status, applied_at, expected_impact")
        .eq("tenant_id", tenantId!)
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ActionRow[];
    },
  });

  const stats = useMemo(() => {
    const total = runs.length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const insights = runs.reduce((s, r) => s + (r.insights_created ?? 0), 0);
    const successRate = total > 0 ? Math.round(((total - failed) / total) * 100) : null;
    return { total, failed, insights, successRate };
  }, [runs]);

  const Icon = ICON_MAP[meta.icon];
  const locale = lang === "ua" ? uk : enUS;

  async function runNow() {
    if (!tenantId) return;
    setRunning(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("not signed in");
      const res = await fetch(`/hooks/agents/${agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        insights_created?: number;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success(`${t("ag.cab.runOk")} (+${json.insights_created ?? 0})`);
    } catch (e) {
      toast.error(`${t("ag.cab.runErr")}: ${e instanceof Error ? e.message : ""}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/agents/library">
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("ag.cab.back")}
        </Link>
      </Button>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/5 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <Badge variant="outline" className="text-xs">
              {t(`ag.cab.cat.${meta.category}` as TKey)}
            </Badge>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {humanizeAgentId(agentId)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`agc.${meta.i18nKey}.what` as TKey)}
            </p>
          </div>
        </div>
        <Button onClick={runNow} disabled={running || !tenantId} size="lg">
          {running ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("ag.cab.running")}
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" /> {t("ag.cab.runNow")}
            </>
          )}
        </Button>
      </header>

      {/* Quick metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label={t("ag.cab.runs")} value={stats.total} />
        <MetricTile
          label={t("ag.cab.successRate")}
          value={stats.successRate != null ? `${stats.successRate}%` : "—"}
          tone={stats.successRate != null && stats.successRate < 80 ? "warn" : "ok"}
        />
        <MetricTile label={t("ag.cab.insightsCreated")} value={stats.insights} />
        <MetricTile
          label={t("ag.cab.actionsApplied")}
          value={actions.filter((a) => a.status === "applied").length}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("ag.cab.what")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-relaxed text-foreground/90">
              <p>{t(`agc.${meta.i18nKey}.what` as TKey)}</p>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("ag.cab.when")}
                </p>
                <p className="mt-1">{t(`agc.${meta.i18nKey}.when` as TKey)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("ag.cab.impact")}
                </p>
                <p className="mt-1">{t(`agc.${meta.i18nKey}.impact` as TKey)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("ag.cab.lastRuns")}</CardTitle>
            </CardHeader>
            <CardContent>
              {tenantLoading || runsLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {runs.slice(0, 12).map((r) => {
                    const ok = r.status === "success";
                    const fail = r.status === "failed";
                    return (
                      <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                        {ok ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : fail ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        <span className="flex-1 text-muted-foreground">
                          {formatDistanceToNow(new Date(r.started_at), { addSuffix: true, locale })}
                        </span>
                        <span className="tabular-nums text-foreground">+{r.insights_created}</span>
                        {fail && r.error && (
                          <span
                            className="max-w-xs truncate text-xs text-destructive"
                            title={r.error}
                          >
                            {r.error}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("ag.cab.recentActions")}</CardTitle>
            </CardHeader>
            <CardContent>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {actions.slice(0, 10).map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          a.status === "applied" && "border-success/30 bg-success/10 text-success",
                          a.status === "reverted" && "border-warning/30 bg-warning/10 text-warning",
                        )}
                      >
                        {a.action_type}
                      </Badge>
                      <span className="flex-1 truncate text-muted-foreground">
                        {a.expected_impact ?? ""}
                      </span>
                      {a.applied_at && (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(a.applied_at), { addSuffix: true, locale })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          {tenantId ? (
            <AgentPermissionsCard tenantId={tenantId} agentId={agentId} />
          ) : (
            <Skeleton className="h-96 w-full" />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "warn" ? "border-warning/30 bg-warning/5" : "border-border/60 bg-card/50",
      )}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
