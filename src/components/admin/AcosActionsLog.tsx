import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, History, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string };

type ActionRow = {
  id: string;
  agent_id: string;
  action_type: string;
  status: string;
  applied_at: string | null;
  measured_at: string | null;
  expected_impact: string | null;
  actual_result: Record<string, unknown> | null;
  target_entity: string | null;
  parameters: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  winback_touch: "Winback touch",
  abandoned_cart_email: "Abandoned-cart email",
  reorder_request: "Reorder request",
  create_seo_page: "Create SEO page",
};

export function AcosActionsLog({ tenantId }: Props) {
  const { data: actions = [], isLoading } = useQuery({
    queryKey: ["acos-actions", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_actions")
        .select("id, agent_id, action_type, status, applied_at, measured_at, expected_impact, actual_result, target_entity, parameters, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ActionRow[];
    },
    refetchInterval: 30_000,
  });

  const totals = {
    applied: actions.filter((a) => a.status === "applied").length,
    measured: actions.filter((a) => a.measured_at != null).length,
    succeeded: actions.filter((a) => {
      const r = a.actual_result as { success?: boolean } | null;
      return r?.success === true;
    }).length,
    revenue: actions.reduce((s, a) => {
      const r = a.actual_result as { impact_cents?: number; recovered_revenue_cents?: number } | null;
      return s + (r?.impact_cents ?? r?.recovered_revenue_cents ?? 0);
    }, 0),
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Actions log
            </CardTitle>
            <CardDescription>
              Applied actions and measured outcomes — auto-refreshes every 30s.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{totals.applied} applied</Badge>
            <Badge variant="outline">{totals.measured} measured</Badge>
            <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
              {totals.succeeded} succeeded
            </Badge>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {Math.round(totals.revenue / 100).toLocaleString("uk-UA")} ₴ attributed
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions applied yet. Approve an insight, then click "Apply action".</p>
        ) : (
          <ScrollArea className="max-h-[420px] pr-3">
            <div className="space-y-1.5">
              {actions.map((a) => {
                const r = a.actual_result as { success?: boolean; impact_cents?: number; recovered_revenue_cents?: number; recovered_orders?: number } | null;
                const succeeded = r?.success === true;
                const impactCents = r?.impact_cents ?? r?.recovered_revenue_cents ?? 0;
                return (
                  <div key={a.id} className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {ACTION_LABEL[a.action_type] ?? a.action_type}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">{a.status}</Badge>
                      {a.measured_at ? (
                        succeeded ? (
                          <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
                            <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> success
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            <MinusCircle className="mr-1 h-2.5 w-2.5" /> no impact
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="text-[10px]">measuring…</Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {a.applied_at
                          ? formatDistanceToNow(new Date(a.applied_at), { addSuffix: true })
                          : formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    {a.expected_impact && (
                      <p className="mt-1 text-[11px] text-muted-foreground">expected: {a.expected_impact}</p>
                    )}
                    {a.measured_at && (
                      <p className="mt-0.5 text-[11px] font-medium text-foreground">
                        actual: {(impactCents / 100).toFixed(2)} ₴
                        {typeof r?.recovered_orders === "number" && ` · ${r.recovered_orders} orders`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
