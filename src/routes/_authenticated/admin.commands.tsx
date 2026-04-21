/**
 * Командний центр супер-адміна — усі ручні запуски в одному місці.
 */
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Play,
  Search,
  Terminal,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { COMMAND_GROUPS, getIndividualAgents, type AdminCommand } from "@/lib/acos/adminCommands";
import { humanizeAgentId } from "@/lib/acos/agentLabels";

export const Route = createFileRoute("/_authenticated/admin/commands")({
  component: AdminCommandsPage,
});

type RunResult = {
  commandId: string;
  ok: boolean;
  status: number;
  ms: number;
  body: unknown;
  startedAt: string;
};

function AdminCommandsPage() {
  const { isSuperAdmin, loading } = useAuth();
  const [tenantId, setTenantId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [extraBodyJson, setExtraBodyJson] = useState<Record<string, string>>({});

  const tenantsQuery = useQuery({
    queryKey: ["admin-cmd-tenants"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tenants = tenantsQuery.data ?? [];
  const selectedTenant = tenants.find((t) => t.id === tenantId);
  const individualAgents = useMemo(() => {
    const list = getIndividualAgents().map((a) => ({
      ...a,
      title: humanizeAgentId(a.id),
    }));
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (a) => a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
    );
  }, [search]);

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;

  async function runCommand(cmd: AdminCommand) {
    if (cmd.scope === "tenant" && !tenantId) {
      toast.error("Спочатку оберіть бренд");
      return;
    }
    setRunning(cmd.id);
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";

      let body: Record<string, unknown> = {};
      if (cmd.scope === "tenant") body.tenant_id = tenantId;
      if (cmd.extraBody) {
        const userJson = extraBodyJson[cmd.id];
        if (userJson) {
          try {
            body = { ...body, ...JSON.parse(userJson) };
          } catch {
            toast.error("Невалідний JSON у додаткових параметрах");
            setRunning(null);
            return;
          }
        } else {
          body = { ...body, ...cmd.extraBody };
        }
      }

      const res = await fetch(cmd.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      const ms = Math.round(performance.now() - t0);
      const result: RunResult = {
        commandId: cmd.id,
        ok: res.ok,
        status: res.status,
        ms,
        body: json,
        startedAt,
      };
      setResults((prev) => [result, ...prev].slice(0, 30));
      if (res.ok) toast.success(`✓ ${cmd.title} · ${ms}ms`);
      else toast.error(`✗ ${cmd.title} · HTTP ${res.status}`);
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      setResults((prev) =>
        [
          {
            commandId: cmd.id,
            ok: false,
            status: 0,
            ms,
            body: { error: err instanceof Error ? err.message : String(err) },
            startedAt,
          },
          ...prev,
        ].slice(0, 30),
      );
      toast.error(err instanceof Error ? err.message : "Помилка запуску");
    } finally {
      setRunning(null);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            Командний центр
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Команди адміна</h1>
          <p className="text-sm text-muted-foreground">
            Усі ручні запуски: оркестратори, двигуни, окремі агенти, telegram, демо-дані.
          </p>
        </div>
      </div>

      {/* Контекст бренду */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Контекст</CardTitle>
          <CardDescription>
            Більшість команд працюють у межах одного бренду. Оберіть бренд нижче — він підставиться
            у виклики автоматично.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="tenant-select">Бренд</Label>
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger id="tenant-select" className="max-w-md">
              <SelectValue placeholder="Оберіть бренд…" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} <span className="text-muted-foreground">/{t.slug}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedTenant && (
            <p className="text-xs text-muted-foreground">
              Активний: <strong>{selectedTenant.name}</strong> · /{selectedTenant.slug} ·{" "}
              <Link
                to="/admin/tenants/$tenantId"
                params={{ tenantId: selectedTenant.id }}
                className="text-primary hover:underline"
              >
                відкрити сторінку бренду →
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="orchestrators" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          {COMMAND_GROUPS.map((g) => (
            <TabsTrigger key={g.key} value={g.key}>
              {g.title}
            </TabsTrigger>
          ))}
          <TabsTrigger value="agents">Окремі агенти ({individualAgents.length})</TabsTrigger>
          <TabsTrigger value="log">Журнал ({results.length})</TabsTrigger>
        </TabsList>

        {COMMAND_GROUPS.map((group) => (
          <TabsContent key={group.key} value={group.key} className="space-y-3">
            <p className="text-sm text-muted-foreground">{group.description}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {group.commands.map((cmd) => (
                <CommandCard
                  key={cmd.id}
                  cmd={cmd}
                  running={running === cmd.id}
                  onRun={() => runCommand(cmd)}
                  hasTenant={!!tenantId}
                  extraBody={extraBodyJson[cmd.id]}
                  onExtraBodyChange={(v) => setExtraBodyJson((p) => ({ ...p, [cmd.id]: v }))}
                />
              ))}
            </div>
          </TabsContent>
        ))}

        <TabsContent value="agents" className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук агента…"
                className="h-9 pl-7"
              />
            </div>
            <Badge variant="outline">{individualAgents.length}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {individualAgents.map((a) => {
              const cmd: AdminCommand = {
                id: a.id,
                path: a.path,
                title: a.title,
                description: a.path,
                scope: "tenant",
              };
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => runCommand(cmd)}
                  disabled={running === a.id || !tenantId}
                  className="group flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 text-left text-sm transition-all hover:border-primary/40 hover:bg-card/70 disabled:opacity-50"
                >
                  {running === a.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Bot className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.title}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{a.id}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
          {!tenantId && (
            <p className="text-xs text-warning">
              Оберіть бренд вгорі, щоб увімкнути запуск окремих агентів.
            </p>
          )}
        </TabsContent>

        <TabsContent value="log" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Журнал запусків</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResults([])}
                  disabled={results.length === 0}
                >
                  Очистити
                </Button>
              </div>
              <CardDescription>Останні 30 запусків у цій сесії.</CardDescription>
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Поки порожньо — запустіть будь-яку команду.
                </p>
              ) : (
                <ScrollArea className="h-[480px]">
                  <div className="space-y-2">
                    {results.map((r, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border/60 bg-card/40 p-3 text-xs"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {r.ok ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                            )}
                            <span className="font-mono font-semibold">{r.commandId}</span>
                            <Badge
                              variant={r.ok ? "default" : "destructive"}
                              className="text-[10px]"
                            >
                              HTTP {r.status}
                            </Badge>
                          </div>
                          <span className="text-muted-foreground">
                            {r.ms}ms · {new Date(r.startedAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[10px] text-foreground">
                          {JSON.stringify(r.body, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CommandCard({
  cmd,
  running,
  onRun,
  hasTenant,
  extraBody,
  onExtraBodyChange,
}: {
  cmd: AdminCommand;
  running: boolean;
  onRun: () => void;
  hasTenant: boolean;
  extraBody?: string;
  onExtraBodyChange: (v: string) => void;
}) {
  const disabled = running || (cmd.scope === "tenant" && !hasTenant);
  const placeholder = cmd.extraBody ? JSON.stringify(cmd.extraBody, null, 2) : "";

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm">{cmd.title}</CardTitle>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{cmd.path}</p>
          </div>
          <Badge
            variant={cmd.scope === "global" ? "default" : "outline"}
            className="shrink-0 text-[10px]"
          >
            {cmd.scope === "global" ? "глобально" : "по бренду"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-3">
        <p className="text-xs text-muted-foreground">{cmd.description}</p>
        {cmd.extraBody && (
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Параметри (JSON)
            </Label>
            <Textarea
              value={extraBody ?? placeholder}
              onChange={(e) => onExtraBodyChange(e.target.value)}
              rows={3}
              className="font-mono text-[11px]"
            />
          </div>
        )}
        <Button onClick={onRun} disabled={disabled} size="sm" className="w-full">
          {running ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Виконується…
            </>
          ) : (
            <>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Запустити
            </>
          )}
        </Button>
        {cmd.scope === "tenant" && !hasTenant && (
          <p className="flex items-center gap-1 text-[10px] text-warning">
            <Terminal className="h-3 w-3" /> Спочатку оберіть бренд
          </p>
        )}
      </CardContent>
    </Card>
  );
}
