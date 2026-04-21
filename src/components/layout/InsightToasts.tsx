/**
 * Real-time pulse-toasts: підписується на нові ai_insights та acos_agent_runs
 * для активного бренду і показує sonner-toast при появі. Глобальний компонент
 * розміщений в _authenticated layout, щоб працював для будь-якого tenant
 * у URL ?tenant=xxx або обраного автоматично.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lightbulb, Bot, HeartPulse, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";

export function InsightToasts() {
  const { user } = useAuth();
  const { t } = useT();
  const seenInsightsRef = useRef<Set<string>>(new Set());
  const seenRunsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const { data: tenants } = useQuery({
    queryKey: ["pulse-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id, name").limit(20);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!tenants || tenants.length === 0) return;
    const tenantIds = tenants.map((t) => t.id);
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.name] as const));

    // Seed seen sets with current state so we don't toast pre-existing rows.
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const [{ data: insights }, { data: runs }] = await Promise.all([
        supabase
          .from("ai_insights")
          .select("id")
          .in("tenant_id", tenantIds)
          .gte("created_at", since),
        supabase
          .from("acos_agent_runs")
          .select("id")
          .in("tenant_id", tenantIds)
          .gte("started_at", since),
      ]);
      if (cancelled) return;
      for (const r of insights ?? []) seenInsightsRef.current.add(r.id);
      for (const r of runs ?? []) seenRunsRef.current.add(r.id);
      initializedRef.current = true;
    })();

    const insightsChannel = supabase
      .channel("pulse-insights")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_insights" },
        (payload) => {
          if (!initializedRef.current) return;
          const row = payload.new as { id: string; tenant_id: string; title: string; risk_level?: string };
          if (!tenantIds.includes(row.tenant_id)) return;
          if (seenInsightsRef.current.has(row.id)) return;
          seenInsightsRef.current.add(row.id);
          const brand = tenantNameById.get(row.tenant_id) ?? "";
          toast(t("toast.newInsight"), {
            description: `${brand ? brand + " · " : ""}${row.title}`,
            icon: <Lightbulb className="h-4 w-4 text-primary" />,
            duration: 6000,
          });
        },
      )
      .subscribe();

    const runsChannel = supabase
      .channel("pulse-runs")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "acos_agent_runs" },
        (payload) => {
          if (!initializedRef.current) return;
          const row = payload.new as {
            id: string;
            tenant_id: string;
            agent_id: string;
            status: string;
            insights_created?: number;
          };
          if (row.status !== "success") return;
          if (!tenantIds.includes(row.tenant_id)) return;
          if (seenRunsRef.current.has(row.id)) return;
          seenRunsRef.current.add(row.id);
          if (!row.insights_created || row.insights_created === 0) return; // тихо пропускаємо порожні запуски
          const brand = tenantNameById.get(row.tenant_id) ?? "";
          toast.success(t("toast.agentCompleted"), {
            description: `${brand ? brand + " · " : ""}${row.agent_id} → +${row.insights_created}`,
            icon: <Bot className="h-4 w-4 text-success" />,
            duration: 4000,
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(insightsChannel);
      void supabase.removeChannel(runsChannel);
    };
  }, [tenants, t]);

  return null;
}
