/**
 * SetupReadinessCard — головна "ground-truth" картка.
 *
 * Читає bootstrap_facts(data_gaps) з результатами data-gap-auditor і
 * показує власнику: відсоток готовності, топ прогалин і кнопку
 * перезапустити всю команду розвідників (8 bootstrap-агентів).
 *
 * Використовується на /brand і /dashboard.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCcw, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

type Gap = { key: string; weight: number; label: string; how: string };
type DataGapsFact = {
  gaps?: Gap[];
  gap_count?: number;
  readiness_score?: number;
  computed_at?: string;
};

type Props = { tenantId: string; tenantSlug: string; compact?: boolean };

export function SetupReadinessCard({ tenantId, tenantSlug, compact = false }: Props) {
  const { t } = useT();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["bootstrap-data-gaps", tenantId],
    enabled: !!tenantId,
    refetchInterval: running ? 5_000 : 60_000,
    queryFn: async (): Promise<DataGapsFact | null> => {
      const { data: row } = await supabase
        .from("bootstrap_facts")
        .select("value, updated_at")
        .eq("tenant_id", tenantId)
        .eq("fact_kind", "data_gaps")
        .eq("fact_key", "default")
        .maybeSingle();
      if (!row?.value) return null;
      return row.value as DataGapsFact;
    },
  });

  const rediscover = useMutation({
    mutationFn: async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Не авторизовано");
      const scouts = [
        "brand-profile",
        "catalog-enricher",
        "margin-estimator",
        "customer-voice",
        "channel-discovery",
        "seasonality-detector",
        "integration-scout",
      ];
      // Запускаємо паралельно, потім — auditor (він читає факти решти)
      await Promise.allSettled(
        scouts.map((s) =>
          fetch(`/hooks/agents/${s}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tenant_id: tenantId }),
          }),
        ),
      );
      await fetch(`/hooks/agents/data-gap-auditor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
    },
    onMutate: () => setRunning(true),
    onSuccess: () => {
      toast.success(t("readiness.toastOk"));
      qc.invalidateQueries({ queryKey: ["bootstrap-data-gaps", tenantId] });
    },
    onError: () => toast.error(t("readiness.toastErr")),
    onSettled: () => setTimeout(() => setRunning(false), 8_000),
  });

  const score = data?.readiness_score ?? 0;
  const pct = Math.round(score * 100);
  const gapCount = data?.gap_count ?? data?.gaps?.length ?? 0;
  const topGaps = (data?.gaps ?? []).slice(0, compact ? 2 : 3);
  const allReady = data && gapCount === 0;
  const lastRunLabel = data?.computed_at
    ? new Date(data.computed_at).toLocaleString()
    : t("readiness.never");

  return (
    <Card className={allReady ? "border-success/30 bg-success/5" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {allReady ? (
                <ShieldCheck className="h-4 w-4 text-success" />
              ) : (
                <Sparkles className="h-4 w-4 text-primary" />
              )}
              {t("readiness.title")}
            </CardTitle>
            <CardDescription className="mt-1">{t("readiness.desc")}</CardDescription>
          </div>
          <Button
            size="sm"
            variant={allReady ? "outline" : "default"}
            disabled={rediscover.isPending || running}
            onClick={() => rediscover.mutate()}
          >
            <RefreshCcw className={`mr-1.5 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? t("readiness.running") : t("readiness.runScouts")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && !data ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : allReady ? (
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            {t("readiness.allReady")}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Progress value={pct} className="h-2 flex-1" />
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{pct}%</span>
              <Badge variant="outline" className="text-[10px]">
                {gapCount} {t("readiness.gapsFound")}
              </Badge>
            </div>
            {topGaps.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("readiness.topGaps")}
                </p>
                <ul className="space-y-1.5">
                  {topGaps.map((g) => (
                    <li key={g.key} className="flex items-start gap-2 text-sm">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      <div className="min-w-0">
                        <p className="font-medium">{g.label}</p>
                        <p className="text-xs text-muted-foreground">{g.how}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!compact && (
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-[11px] text-muted-foreground">
                  {t("readiness.lastRun")}: {lastRunLabel}
                </span>
                <Button asChild variant="link" size="sm" className="h-auto px-0 text-xs">
                  <Link to="/onboarding" search={{ tenant: tenantId, slug: tenantSlug }}>
                    {t("readiness.openChecklist")} →
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
