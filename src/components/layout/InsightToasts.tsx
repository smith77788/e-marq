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
  const seenNotifsRef = useRef<Set<string>>(new Set());
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
      const [{ data: insights }, { data: runs }, { data: notifs }] = await Promise.all([
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
        supabase
          .from("owner_notifications")
          .select("id")
          .in("tenant_id", tenantIds)
          .in("kind", ["dntrade_unhealthy", "dntrade_partial_repeat"])
          .gte("created_at", since),
      ]);
      if (cancelled) return;
      for (const r of insights ?? []) seenInsightsRef.current.add(r.id);
      for (const r of runs ?? []) seenRunsRef.current.add(r.id);
      for (const r of notifs ?? []) seenNotifsRef.current.add(r.id);
      initializedRef.current = true;
    })();

    const insightsChannel = supabase
      .channel("pulse-insights")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_insights" },
        (payload) => {
          if (!initializedRef.current) return;
          const row = payload.new as {
            id: string;
            tenant_id: string;
            title: string;
            risk_level?: string;
          };
          if (!tenantIds.includes(row.tenant_id)) return;
          if (seenInsightsRef.current.has(row.id)) return;
          seenInsightsRef.current.add(row.id);
          const risk = (row.risk_level ?? "low").toLowerCase();
          // Toast лише для high/critical — інакше шум.
          if (risk !== "high" && risk !== "critical") return;
          const brand = tenantNameById.get(row.tenant_id) ?? "";
          const title = risk === "critical" ? t("toast.criticalInsight") : t("toast.highInsight");
          const fn = risk === "critical" ? toast.error : toast.warning;
          fn(title, {
            description: `${brand ? brand + " · " : ""}${row.title}`,
            icon: <Lightbulb className="h-4 w-4" />,
            duration: 8000,
            action: {
              label: t("toast.openLabel"),
              onClick: () => {
                window.location.href = "/brand#insights";
              },
            },
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
            metadata?: Record<string, unknown> | null;
            error?: string | null;
          };
          if (!tenantIds.includes(row.tenant_id)) return;
          if (seenRunsRef.current.has(row.id)) return;

          if (row.status === "failed") {
            seenRunsRef.current.add(row.id);
            const brand = tenantNameById.get(row.tenant_id) ?? "";
            toast.error(t("toast.agentFailed"), {
              description: `${brand ? brand + " · " : ""}${row.agent_id}${row.error ? " — " + row.error.slice(0, 120) : ""}`,
              icon: <Bot className="h-4 w-4 text-destructive" />,
              duration: 9000,
              action: {
                label: t("toast.openLabel"),
                onClick: () => {
                  window.location.href = "/agents/live";
                },
              },
            });
            return;
          }

          if (row.status !== "success") return;
          seenRunsRef.current.add(row.id);
          // Digest agents honestly report insights_created=0 and surface their
          // work as metadata.digests_created — still worth a completion toast.
          const digestsCreated =
            typeof row.metadata?.digests_created === "number" ? row.metadata.digests_created : 0;
          const insights = row.insights_created ?? 0;
          if (insights === 0 && digestsCreated === 0) return;
          const brand = tenantNameById.get(row.tenant_id) ?? "";
          const work = insights > 0 ? `+${insights}` : `${digestsCreated} ✉`;
          toast.success(t("toast.agentCompleted"), {
            description: `${brand ? brand + " · " : ""}${row.agent_id} → ${work}`,
            icon: <Bot className="h-4 w-4 text-success" />,
            duration: 4000,
          });
        },
      )
      .subscribe();

    const notifsChannel = supabase
      .channel("pulse-dntrade-notifs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "owner_notifications" },
        (payload) => {
          if (!initializedRef.current) return;
          const row = payload.new as {
            id: string;
            tenant_id: string;
            kind: string;
            title: string;
            body: string | null;
            severity: string;
          };
          if (!tenantIds.includes(row.tenant_id)) return;
          if (row.kind !== "dntrade_unhealthy" && row.kind !== "dntrade_partial_repeat") return;
          if (seenNotifsRef.current.has(row.id)) return;
          seenNotifsRef.current.add(row.id);
          const brand = tenantNameById.get(row.tenant_id) ?? "";
          const desc = `${brand ? brand + " · " : ""}${row.body ?? ""}`.slice(0, 220);
          const isHigh = row.severity === "high" || row.kind === "dntrade_unhealthy";
          (isHigh ? toast.error : toast.warning)(row.title, {
            description: desc,
            icon: isHigh ? (
              <HeartPulse className="h-4 w-4 text-destructive" />
            ) : (
              <TriangleAlert className="h-4 w-4 text-warning" />
            ),
            duration: 9000,
            action: {
              label: t("toast.detailsLabel"),
              onClick: () => {
                window.location.href = "/brand";
              },
            },
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(insightsChannel);
      void supabase.removeChannel(runsChannel);
      void supabase.removeChannel(notifsChannel);
    };
  }, [tenants, t]);

  return null;
}
