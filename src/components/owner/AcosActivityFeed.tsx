/**
 * ACOS Loop Activity Feed
 * Хронологія подій повного циклу: insight → decision → approval → execution → outcome.
 * Pure-read UI з view `acos_loop_activity`.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, ListChecks, CheckCircle2, Play, TrendingUp, Minus } from "lucide-react";

type Activity = {
  tenant_id: string;
  event_type:
    | "insight_created"
    | "decision_proposed"
    | "decision_approved"
    | "decision_executed"
    | "outcome_success"
    | "outcome_neutral";
  event_at: string;
  title: string | null;
  subtype: string | null;
  layer: string | null;
  risk_level: string | null;
  ref_id: string | null;
  detail: string | null;
};

const EVENT_META: Record<
  Activity["event_type"],
  { icon: React.ReactNode; label: string; tone: string }
> = {
  insight_created: {
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    label: "Новий сигнал",
    tone: "text-warning border-warning/40 bg-warning/10",
  },
  decision_proposed: {
    icon: <ListChecks className="h-3.5 w-3.5" />,
    label: "Запропоновано дію",
    tone: "text-muted-foreground border-border bg-muted/40",
  },
  decision_approved: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "Схвалено",
    tone: "text-primary border-primary/40 bg-primary/10",
  },
  decision_executed: {
    icon: <Play className="h-3.5 w-3.5" />,
    label: "Виконано",
    tone: "text-primary border-primary/40 bg-primary/10",
  },
  outcome_success: {
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    label: "+ Результат",
    tone: "text-success border-success/40 bg-success/10",
  },
  outcome_neutral: {
    icon: <Minus className="h-3.5 w-3.5" />,
    label: "Нейтрально",
    tone: "text-muted-foreground border-border bg-muted/40",
  },
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.round(h / 24);
  return `${d} дн тому`;
}

export function AcosActivityFeed({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(null);
      const { data, error } = await supabase
        .from("acos_loop_activity" as never)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("event_at", { ascending: false })
        .limit(40);
      if (!cancelled) {
        if (error) {
          setFetchError(error.message);
        } else if (data) {
          setItems(data as Activity[]);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Хронологія циклу</CardTitle>
        <CardDescription>
          Останні події ACOS-loop: сигнали, рішення, виконання, виміри.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : fetchError ? (
          <p className="py-6 text-center text-sm text-destructive">{fetchError}</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Поки тиша — агенти ще не згенерували подій.
          </p>
        ) : (
          <ScrollArea className="h-[480px] pr-3">
            <ol className="relative space-y-3 border-l border-border pl-4">
              {items.map((ev, i) => {
                const meta = EVENT_META[ev.event_type];
                return (
                  <li key={`${ev.ref_id}-${i}`} className="relative">
                    <span className="absolute -left-[21px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background ring-2 ring-border" />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={`gap-1 border ${meta.tone}`}>
                        {meta.icon}
                        <span className="text-[10px] uppercase tracking-wide">{meta.label}</span>
                      </Badge>
                      {ev.subtype && (
                        <Badge variant="secondary" className="text-[10px]">
                          {ev.subtype}
                        </Badge>
                      )}
                      {ev.risk_level && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          risk: {ev.risk_level}
                        </Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {timeAgo(ev.event_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-snug">{ev.title ?? "—"}</p>
                    {ev.detail && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{ev.detail}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
