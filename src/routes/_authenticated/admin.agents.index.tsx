/**
 * /admin/agents — super-admin index of all agents seen in acos_agent_runs.
 * Cards: agent_id, runs_total / fail_rate / insights за 7d, лінк на deep-dive.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Bot, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { humanizeAgentId } from "@/lib/acos/agentLabels";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/agents/")({
  head: () => ({
    meta: [
      { title: "Agents (admin) — MARQ" },
      { name: "description", content: "Усі агенти cross-tenant" },
    ],
  }),
  component: AdminAgentsIndex,
});

type RunRow = {
  agent_id: string;
  status: string;
  insights_created: number | null;
  tenant_id: string | null;
  started_at: string;
};

type AgentAgg = {
  agent_id: string;
  runs: number;
  failed: number;
  insights: number;
  tenants: number;
  lastRun: string | null;
};

function AdminAgentsIndex() {
  const { isSuperAdmin, loading } = useAuth();
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("acos_agent_runs")
        .select("agent_id, status, insights_created, tenant_id, started_at")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(5000);
      if (error) {
        setRows([]);
        return;
      }
      setRows((data ?? []) as RunRow[]);
    })();
  }, []);

  const agents = useMemo<AgentAgg[]>(() => {
    if (!rows) return [];
    const map = new Map<string, AgentAgg & { tenantSet: Set<string> }>();
    for (const r of rows) {
      const cur =
        map.get(r.agent_id) ??
        ({
          agent_id: r.agent_id,
          runs: 0,
          failed: 0,
          insights: 0,
          tenants: 0,
          lastRun: null,
          tenantSet: new Set<string>(),
        } as AgentAgg & { tenantSet: Set<string> });
      cur.runs += 1;
      if (r.status === "failed") cur.failed += 1;
      cur.insights += r.insights_created ?? 0;
      if (r.tenant_id) cur.tenantSet.add(r.tenant_id);
      if (!cur.lastRun || r.started_at > cur.lastRun) cur.lastRun = r.started_at;
      map.set(r.agent_id, cur);
    }
    const list = Array.from(map.values()).map((a) => ({
      ...a,
      tenants: a.tenantSet.size,
    }));
    return list.sort((a, b) => b.runs - a.runs);
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter(
      (a) =>
        a.agent_id.toLowerCase().includes(needle) ||
        humanizeAgentId(a.agent_id).toLowerCase().includes(needle),
    );
  }, [agents, q]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agents (cross-tenant)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Усі агенти, які запускались за останні 7 днів. Клік для deep-dive по агенту.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Пошук по agent_id…"
          className="pl-9"
        />
      </div>

      {rows === null ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Жодного запуску за 7 днів.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const failRate = a.runs > 0 ? a.failed / a.runs : 0;
            return (
              <Link
                key={a.agent_id}
                to="/admin/agents/$agentId"
                params={{ agentId: a.agent_id }}
                className="group"
              >
                <Card className="transition-all hover:border-primary/50 hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-start gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="truncate text-sm">
                          {humanizeAgentId(a.agent_id)}
                        </CardTitle>
                        <CardDescription className="truncate font-mono text-[11px]">
                          {a.agent_id}
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          failRate > 0.3 && "border-destructive/40 text-destructive",
                          failRate > 0.05 && failRate <= 0.3 && "border-warning/40 text-warning",
                          failRate <= 0.05 && "border-success/40 text-success",
                        )}
                      >
                        {Math.round((1 - failRate) * 100)}%
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Runs" value={a.runs} />
                    <Stat label="Insights" value={a.insights} />
                    <Stat label="Tenants" value={a.tenants} />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
