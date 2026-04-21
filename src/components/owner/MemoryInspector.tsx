/**
 * Memory Inspector — shows active ai_memory rules learned by agents.
 * Owner can deactivate bad patterns (low confidence, negative impact).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Brain, CheckCircle2, Loader2, Power, PowerOff, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type MemoryRow = {
  id: string;
  agent: string;
  category: string;
  pattern_key: string;
  learned_rule: string;
  confidence: number;
  success_count: number;
  failure_count: number;
  avg_impact: number;
  is_active: boolean;
  last_observed_at: string;
};

type Filter = "all" | "active" | "inactive";

import { AGENT_HUMAN_LABELS } from "@/lib/acos/agentLabels";
const AGENT_LABELS: Record<string, string> = {
  ...AGENT_HUMAN_LABELS,
  abandoned_cart: "Повернення кошиків",
  feedback_loop: "Навчання на відгуках",
};

function formatRule(rule: string): string {
  if (!rule) return "—";
  // Pretty-print snake_case keys: "discount_pct=10" → "discount 10%"
  return rule
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

function impactBadge(avg: number) {
  if (avg > 500)
    return (
      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
        <TrendingUp className="mr-1 h-3 w-3" /> +${(avg / 100).toFixed(0)}
      </Badge>
    );
  if (avg < -100)
    return (
      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
        <TrendingDown className="mr-1 h-3 w-3" /> ${(avg / 100).toFixed(0)}
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      ±${Math.abs(avg / 100).toFixed(0)}
    </Badge>
  );
}

export function MemoryInspector({ tenantId }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("active");

  const { data: memories, isLoading } = useQuery({
    queryKey: ["ai-memory", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_memory")
        .select("id, agent, category, pattern_key, learned_rule, confidence, success_count, failure_count, avg_impact, is_active, last_observed_at")
        .eq("tenant_id", tenantId)
        .order("confidence", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as MemoryRow[];
    },
    refetchInterval: 60_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase
        .from("ai_memory")
        .update({ is_active: next })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.next ? "Правило знову працює" : "Правило вимкнено");
      qc.invalidateQueries({ queryKey: ["ai-memory", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    if (!memories) return [];
    if (filter === "active") return memories.filter((m) => m.is_active);
    if (filter === "inactive") return memories.filter((m) => !m.is_active);
    return memories;
  }, [memories, filter]);

  const stats = useMemo(() => {
    const list = memories ?? [];
    const active = list.filter((m) => m.is_active).length;
    const totalSuccess = list.reduce((s, m) => s + m.success_count, 0);
    const totalFailure = list.reduce((s, m) => s + m.failure_count, 0);
    const winRate = totalSuccess + totalFailure > 0 ? totalSuccess / (totalSuccess + totalFailure) : 0;
    return { active, total: list.length, winRate };
  }, [memories]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Памʼять системи
            </CardTitle>
            <CardDescription>
              Правила, яких агенти навчилися самі. Вимкніть ті, що зменшують виторг.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{stats.active}</strong>/{stats.total} увімкнено</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-success" />
              <strong className="text-foreground">{(stats.winRate * 100).toFixed(0)}%</strong> успішних
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Увімкнені</TabsTrigger>
            <TabsTrigger value="inactive">Вимкнені</TabsTrigger>
            <TabsTrigger value="all">Усі</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження памʼяті…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Поки немає правил. Агенти мають попрацювати кілька циклів, щоб навчитися.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((m) => {
              const trials = m.success_count + m.failure_count;
              const winRate = trials > 0 ? m.success_count / trials : 0;
              return (
                <li
                  key={m.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    m.is_active ? "border-border bg-card" : "border-dashed border-border/60 bg-muted/30 opacity-70"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {AGENT_LABELS[m.agent] ?? m.agent}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{m.category}</Badge>
                        {impactBadge(m.avg_impact)}
                      </div>
                      <p className="text-sm font-medium text-foreground">{formatRule(m.learned_rule || m.pattern_key)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {m.success_count}✓ / {m.failure_count}✗ · востаннє {new Date(m.last_observed_at).toLocaleDateString("uk-UA")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={m.is_active ? "ghost" : "outline"}
                      onClick={() => toggle.mutate({ id: m.id, next: !m.is_active })}
                      disabled={toggle.isPending}
                    >
                      {toggle.isPending && toggle.variables?.id === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : m.is_active ? (
                        <><PowerOff className="mr-1 h-3.5 w-3.5" /> Вимкнути</>
                      ) : (
                        <><Power className="mr-1 h-3.5 w-3.5" /> Увімкнути</>
                      )}
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={Math.round(winRate * 100)} className="h-1.5 flex-1" />
                    <span className="w-20 text-right text-[11px] tabular-nums text-muted-foreground">
                      {(m.confidence * 100).toFixed(0)}% впевн.
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
