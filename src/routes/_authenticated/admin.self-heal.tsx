/**
 * Self-Healing Engine — admin cockpit page.
 *
 * Super-admin only. Surfaces:
 *   - Health dashboard (5 modules: Detector, Root Cause, Isolation, Auto-Fix, Regression Guard)
 *   - Active incidents queue (with Apply/Block buttons for proposals)
 *   - Recent auto-heal action log (with Revert)
 *   - Settings panel (kill-switch, allowed kinds, severity threshold)
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/self-heal")({
  head: () => ({
    meta: [
      { title: "Self-Heal Engine" },
      { name: "description", content: "Autonomous production resilience cockpit" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SelfHealRoute,
});

type Severity = "p0" | "p1" | "p2" | "p3";
type IncidentStatus = "open" | "fixing" | "fixed" | "blocked" | "monitoring" | "dismissed";

type Incident = {
  id: string;
  inc_code: string;
  tenant_id: string | null;
  detector: string;
  severity: Severity;
  title: string;
  root_cause: string | null;
  scope_json: Record<string, unknown>;
  regression_risk: "low" | "medium" | "high";
  status: IncidentStatus;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

type ActionRow = {
  id: string;
  incident_id: string | null;
  kind: string;
  decision: "apply" | "propose" | "block" | "monitor";
  status: "pending" | "applied" | "reverted" | "failed" | "skipped";
  reversible: boolean;
  result_text: string | null;
  applied_at: string | null;
  reverted_at: string | null;
  created_at: string;
};

type Settings = {
  auto_heal_enabled: boolean;
  allowed_kinds: string[];
  severity_threshold: Severity;
};

function SelfHealRoute() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <SelfHealContent />;
}

const SEVERITY_LABEL: Record<Severity, { label: string; className: string }> = {
  p0: { label: "P0 — critical", className: "bg-destructive text-destructive-foreground" },
  p1: { label: "P1 — high", className: "bg-warning text-warning-foreground" },
  p2: { label: "P2 — medium", className: "bg-info text-info-foreground" },
  p3: { label: "P3 — low", className: "bg-muted text-muted-foreground" },
};

function SelfHealContent() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  // Realtime invalidation
  useEffect(() => {
    const channel = supabase
      .channel("self-heal-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "self_heal_incidents" },
        () => qc.invalidateQueries({ queryKey: ["self-heal-incidents"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "self_heal_actions" },
        () => qc.invalidateQueries({ queryKey: ["self-heal-actions"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  const incidentsQ = useQuery({
    queryKey: ["self-heal-incidents"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("self_heal_incidents")
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Incident[];
    },
  });

  const actionsQ = useQuery({
    queryKey: ["self-heal-actions"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("self_heal_actions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ActionRow[];
    },
  });

  const settingsQ = useQuery({
    queryKey: ["self-heal-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("self_heal_settings")
        .select("key, value");
      if (error) throw error;
      const map = new Map((data ?? []).map((r) => [r.key, r.value]));
      return {
        auto_heal_enabled: (map.get("auto_heal_enabled") as boolean) ?? true,
        allowed_kinds: (map.get("allowed_kinds") as string[]) ?? [],
        severity_threshold: ((map.get("severity_threshold") as Severity) ?? "p2"),
      } as Settings;
    },
  });

  const incidentsAll = incidentsQ.data ?? [];
  const actions = actionsQ.data ?? [];
  const settings = settingsQ.data;

  const incidents = useMemo(
    () => incidentsAll.filter((i) => ["open", "fixing", "monitoring", "blocked"].includes(i.status)),
    [incidentsAll],
  );

  // ANY skipped action with a decision other than "apply" is something the admin can act on.
  const pendingProposals = useMemo(
    () => actions.filter((a) => a.status === "skipped" && a.decision !== "apply"),
    [actions],
  );
  const recentApplied = useMemo(
    () =>
      actions
        .filter((a) => a.status === "applied" || a.status === "reverted" || a.status === "failed")
        .slice(0, 50),
    [actions],
  );

  const counts = useMemo(() => {
    const open = incidents.filter((i) => i.status === "open").length;
    const fixing = incidents.filter((i) => i.status === "fixing").length;
    const blocked = incidents.filter((i) => i.status === "blocked").length;
    const p0p1 = incidents.filter((i) => i.severity === "p0" || i.severity === "p1").length;
    return { open, fixing, blocked, p0p1 };
  }, [incidents]);

  const moduleStatus = (count: number, threshold = 1) =>
    count === 0 ? "ok" : count < threshold ? "warn" : "fail";

  const runCycle = async () => {
    setRunning(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        toast.error("Not authenticated");
        return;
      }
      const res = await fetch("/hooks/agents/self-heal-engine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { ok?: boolean; summary?: Record<string, unknown>; error?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Cycle failed");
        return;
      }
      const s = json.summary ?? {};
      toast.success(
        `Cycle done: ${s.incidents_created ?? 0} new, ${s.actions_applied ?? 0} applied`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["self-heal-incidents"] }),
        qc.invalidateQueries({ queryKey: ["self-heal-actions"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cycle failed");
    } finally {
      setRunning(false);
    }
  };

  const callAction = async (path: string, actionId: string, label: string) => {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return toast.error("Not authenticated");
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action_id: actionId }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    if (res.ok && json.ok) {
      toast.success(`${label}: ${json.message ?? "done"}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["self-heal-incidents"] }),
        qc.invalidateQueries({ queryKey: ["self-heal-actions"] }),
      ]);
    } else {
      toast.error(json.error ?? json.message ?? "Failed");
    }
  };

  const toggleAutoHeal = async (next: boolean) => {
    const { error } = await supabase
      .from("self_heal_settings")
      .update({ value: next as unknown as never })
      .eq("key", "auto_heal_enabled");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Auto-heal ${next ? "enabled" : "disabled"}`);
    await qc.invalidateQueries({ queryKey: ["self-heal-settings"] });
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            🛡 Self-Healing Engine
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Autonomous production resilience — detect, isolate, heal, and guard.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {settings && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
              <Label htmlFor="auto-heal" className="text-xs">
                Auto-heal
              </Label>
              <Switch
                id="auto-heal"
                checked={settings.auto_heal_enabled}
                onCheckedChange={toggleAutoHeal}
              />
            </div>
          )}
          <Button onClick={runCycle} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Run cycle now
          </Button>
        </div>
      </div>

      {/* HEALTH DASHBOARD — 5 modules */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <ModuleCard
          icon={Activity}
          title="Detector"
          status={moduleStatus(counts.open, 5)}
          metric={`${counts.open} open`}
        />
        <ModuleCard
          icon={Sparkles}
          title="Root Cause"
          status={incidents.length > 0 ? "ok" : "ok"}
          metric={`${incidents.length} analyzed`}
        />
        <ModuleCard
          icon={ShieldCheck}
          title="Isolation"
          status={moduleStatus(counts.blocked, 1)}
          metric={`${counts.blocked} blocked`}
        />
        <ModuleCard
          icon={Zap}
          title="Auto-Fix"
          status={settings?.auto_heal_enabled ? "ok" : "warn"}
          metric={settings?.auto_heal_enabled ? "armed" : "disarmed"}
        />
        <ModuleCard
          icon={CheckCircle2}
          title="Regression Guard"
          status={counts.p0p1 === 0 ? "ok" : "warn"}
          metric={`${counts.p0p1} P0/P1`}
        />
      </div>

      {/* PENDING PROPOSALS */}
      {pendingProposals.length > 0 && (
        <Card className="border-warning/40 shadow-glow-violet">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Pending proposals ({pendingProposals.length})
            </CardTitle>
            <CardDescription>
              Risky fixes that need explicit Apply confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingProposals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.kind}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        type="button"
                        onClick={() =>
                          callAction("/hooks/agents/self-heal-apply", a.id, "Applied")
                        }
                      >
                        Apply
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* INCIDENTS QUEUE */}
      <Card>
        <CardHeader>
          <CardTitle>Active incidents ({incidents.length})</CardTitle>
          <CardDescription>
            Real-time queue from all detectors. Auto-refresh every 30s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {incidentsQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-success" />
              No active incidents — all systems healthy.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">ID</TableHead>
                  <TableHead className="w-28">Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Root cause</TableHead>
                  <TableHead className="w-20">Risk</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.inc_code}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs", SEVERITY_LABEL[i.severity].className)}>
                        {SEVERITY_LABEL[i.severity].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{i.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {i.root_cause}
                    </TableCell>
                    <TableCell className="text-xs uppercase">{i.regression_risk}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {i.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* AUTO-HEAL LOG */}
      <Card>
        <CardHeader>
          <CardTitle>Auto-heal log</CardTitle>
          <CardDescription>Last applied/reverted actions (max 50).</CardDescription>
        </CardHeader>
        <CardContent>
          {actionsQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : recentApplied.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No actions applied yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentApplied.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.kind}</TableCell>
                    <TableCell>
                      <Badge
                        variant={a.status === "applied" ? "default" : "outline"}
                        className="text-xs"
                      >
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                      {a.result_text ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.applied_at ?? a.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.status === "applied" && a.reversible ? (
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() =>
                            callAction("/hooks/agents/self-heal-revert", a.id, "Reverted")
                          }
                        >
                          <RotateCcw className="mr-1 h-3 w-3" /> Revert
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleCard({
  icon: Icon,
  title,
  status,
  metric,
}: {
  icon: typeof Activity;
  title: string;
  status: "ok" | "warn" | "fail";
  metric: string;
}) {
  const tone =
    status === "ok"
      ? "border-success/40 text-success"
      : status === "warn"
        ? "border-warning/40 text-warning"
        : "border-destructive/40 text-destructive";
  const Indicator = status === "fail" ? XCircle : status === "warn" ? AlertTriangle : CheckCircle2;
  return (
    <Card className={cn("border-2", tone)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-70" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Indicator className="h-5 w-5" />
          <span className="text-lg font-semibold tabular-nums">{metric}</span>
        </div>
      </CardContent>
    </Card>
  );
}
