/**
 * Compact ACOS Loop summary for the cockpit.
 * Шанс власнику побачити: чи є щось у черзі схвалень, скільки виконано, скільки заробили агенти.
 * Лінкує на повний дашборд /brand/acos-loop.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Inbox, TrendingUp, CheckCircle2 } from "lucide-react";

type Overview = {
  insights_30d: number | null;
  decisions_pending: number | null;
  decisions_approved: number | null;
  decisions_done: number | null;
  outcomes_success: number | null;
  attributed_revenue_cents: number | null;
  success_rate: number | null;
};

function fmtMoney(cents: number | null) {
  if (!cents) return "0 ₴";
  return `${Math.round(cents / 100).toLocaleString()} ₴`;
}

export function AcosLoopSummary({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase
      .from("acos_loop_overview")
      .select(
        "insights_30d,decisions_pending,decisions_approved,decisions_done,outcomes_success,attributed_revenue_cents,success_rate",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setData((data as Overview) ?? null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  const pending = data.decisions_pending ?? 0;
  const done = data.decisions_done ?? 0;
  const revenue = data.attributed_revenue_cents ?? 0;
  const successRate =
    data.success_rate == null ? null : Math.round(Number(data.success_rate) * 100);

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-warning" />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">У черзі</p>
              <p className="text-xl font-semibold">
                {pending}
                {pending > 0 && (
                  <Badge className="ml-2 bg-warning text-warning-foreground">треба схвалити</Badge>
                )}
              </p>
            </div>
          </div>
          <Divider />
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Виконано</p>
              <p className="text-xl font-semibold">
                {done}
                {successRate !== null && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {successRate}% success
                  </span>
                )}
              </p>
            </div>
          </div>
          <Divider />
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Атрибутований дохід
              </p>
              <p className="text-xl font-semibold text-primary">{fmtMoney(revenue)}</p>
            </div>
          </div>
        </div>
        <Button asChild variant={pending > 0 ? "default" : "outline"} size="sm">
          <Link to="/brand/acos-loop" search={{ tenant: tenantId }}>
            Open ACOS Loop
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Divider() {
  return <div className="hidden h-10 w-px bg-border md:block" />;
}
