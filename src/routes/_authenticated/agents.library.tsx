/**
 * Agent Library — catalog of every agent in the fleet.
 * Owners pick an agent here to inspect details, runs, and configure permissions.
 * Each row also offers a quick mode toggle (off/suggest/auto).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Brain,
  Coins,
  Mail,
  Megaphone,
  Search,
  Shield,
  ShoppingCart,
  Sparkles,
  Tag,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useT, tStatic, type TKey } from "@/lib/i18n";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import {
  AGENT_CATALOG,
  CATEGORY_ORDER,
  type AgentCategory,
  type AgentMeta,
} from "@/lib/acos/agentCatalog";
import { humanizeAgentId } from "@/lib/acos/agentLabels";

export const Route = createFileRoute("/_authenticated/agents/library")({
  head: () => ({
    meta: [
      { title: tStatic("ag.cab.libTitle") },
      { name: "description", content: tStatic("ag.cab.libDesc") },
    ],
  }),
  component: AgentLibraryPage,
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

const CATEGORY_TONE: Record<AgentCategory, string> = {
  growth: "text-success border-success/30 bg-success/5",
  retention: "text-info border-info/30 bg-info/5",
  operations: "text-warning border-warning/30 bg-warning/5",
  communication: "text-primary border-primary/30 bg-primary/5",
  content_seo: "text-accent border-accent/30 bg-accent/5",
  analytics: "text-info border-info/30 bg-info/5",
  ai_quality: "text-primary border-primary/30 bg-primary/5",
  safety: "text-destructive border-destructive/30 bg-destructive/5",
};

type RunStat = {
  agent_id: string;
  total: number;
  failed: number;
  insights: number;
};

type PermRow = { agent_id: string; mode: "off" | "suggest" | "auto" };

function AgentLibraryPage() {
  const { t } = useT();
  const { current, loading: tenantLoading } = useTenantContext();
  const tenantId = current?.tenant_id ?? null;

  const sevenDaysAgo = useMemo(
    () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const { data: runStats = [], isLoading: runsLoading } = useQuery<RunStat[]>({
    queryKey: ["agent-library-runs", tenantId, sevenDaysAgo],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acos_agent_runs")
        .select("agent_id, status, insights_created")
        .eq("tenant_id", tenantId!)
        .gte("started_at", sevenDaysAgo)
        .limit(2000);
      if (error) throw error;
      const agg = new Map<string, RunStat>();
      for (const r of data ?? []) {
        const cur = agg.get(r.agent_id) ?? {
          agent_id: r.agent_id,
          total: 0,
          failed: 0,
          insights: 0,
        };
        cur.total += 1;
        if (r.status === "failed") cur.failed += 1;
        cur.insights += r.insights_created ?? 0;
        agg.set(r.agent_id, cur);
      }
      return [...agg.values()];
    },
  });

  const { data: permissions = [] } = useQuery<PermRow[]>({
    queryKey: ["agent-library-perms", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_permissions")
        .select("agent_id, mode")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return (data ?? []) as PermRow[];
    },
  });

  const statByAgent = useMemo(() => {
    const m = new Map<string, RunStat>();
    for (const s of runStats) m.set(s.agent_id, s);
    return m;
  }, [runStats]);

  const modeByAgent = useMemo(() => {
    const m = new Map<string, PermRow["mode"]>();
    for (const p of permissions) m.set(p.agent_id, p.mode);
    return m;
  }, [permissions]);

  const grouped = useMemo(() => {
    const map = new Map<AgentCategory, AgentMeta[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const a of AGENT_CATALOG) {
      map.get(a.category)?.push(a);
    }
    return map;
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <Badge variant="outline" className="border-accent/30 bg-accent/5 text-accent">
          <Bot className="mr-1 h-3 w-3" /> {t("ag.cab.libTitle")}
        </Badge>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("ag.cab.libTitle")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("ag.cab.libDesc")}</p>
      </header>

      {tenantLoading || (tenantId && runsLoading) ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !tenantId ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t("ag.liveNoTenantDesc")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={cat} className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(`ag.cab.cat.${cat}` as TKey)}
                </h2>
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/60">
                      {list.map((agent) => {
                        const Icon = ICON_MAP[agent.icon];
                        const stat = statByAgent.get(agent.id);
                        const mode = modeByAgent.get(agent.id) ?? "suggest";
                        const successRate =
                          stat && stat.total > 0
                            ? Math.round(((stat.total - stat.failed) / stat.total) * 100)
                            : null;
                        return (
                          <Link
                            key={agent.id}
                            to="/agents/$agentId"
                            params={{ agentId: agent.id }}
                            className="flex flex-col gap-3 p-4 transition-colors hover:bg-accent/5 sm:flex-row sm:items-center"
                          >
                            <div
                              className={cn(
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                                CATEGORY_TONE[agent.category],
                              )}
                            >
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-foreground">
                                  {humanizeAgentId(agent.id)}
                                </p>
                                <ModeBadge mode={mode} />
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {t(`agc.${agent.i18nKey}.what` as TKey)}
                              </p>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-right text-xs sm:w-64">
                              <div>
                                <p className="text-muted-foreground">{t("ag.cab.colRuns")}</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {stat?.total ?? 0}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">{t("ag.cab.colSuccess")}</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {successRate != null ? `${successRate}%` : "—"}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">{t("ag.cab.colImpact")}</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {stat?.insights ?? 0}
                                </p>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: "off" | "suggest" | "auto" }) {
  const { t } = useT();
  const cls =
    mode === "auto"
      ? "border-success/30 bg-success/10 text-success"
      : mode === "off"
        ? "border-muted-foreground/30 bg-muted text-muted-foreground"
        : "border-warning/30 bg-warning/10 text-warning";
  const label =
    mode === "auto"
      ? t("ag.cab.modeAuto")
      : mode === "off"
        ? t("ag.cab.modeOff")
        : t("ag.cab.modeSuggest");
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-semibold uppercase tracking-wide", cls)}
    >
      {label}
    </Badge>
  );
}
