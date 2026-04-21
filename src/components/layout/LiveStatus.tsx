import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pulse indicator showing whether agents have run in the last 15 minutes.
 * Tenant-scoped when tenantId given; otherwise global (super-admin view).
 */
export function LiveStatus({ tenantId }: { tenantId?: string | null }) {
  const { data } = useQuery({
    queryKey: ["live-status", tenantId ?? "all"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      let q = supabase
        .from("acos_agent_runs")
        .select("id", { count: "exact", head: true })
        .gte("started_at", since);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  const live = (data ?? 0) > 0;

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs">
      <span className={live ? "pulse-dot" : "inline-block h-2 w-2 rounded-full bg-muted-foreground/40"} />
      <span className="font-medium text-foreground">
        {live ? "Агенти працюють" : "Спокій"}
      </span>
      {data !== undefined && (
        <span className="text-muted-foreground">· {data} запусків / 15 хв</span>
      )}
    </div>
  );
}
