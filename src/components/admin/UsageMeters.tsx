/**
 * Renders a grid of usage / limit progress bars from get_tenant_plan_summary().
 * NULL limit = unlimited (renders ∞).
 */
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type PlanSummary = {
  plan: { id: string; key: string; name: string; price_cents_monthly: number; currency: string; features_enabled: string[]; agents_allowed: string[] };
  subscription: {
    status: string;
    trial_ends_at: string | null;
    current_period_start: string;
    current_period_end: string;
    overrides: Record<string, unknown>;
  };
  balances: {
    ai_credits_balance: number;
    ai_credits_granted_this_period: number;
    ai_credits_consumed_this_period: number;
    money_balance_cents: number;
    currency: string;
  };
  limits: Record<string, number | null>;
  usage: Record<string, number>;
};

const METRICS: Array<{ key: string; limitKey: string; label: string }> = [
  { key: "products_count", limitKey: "max_products", label: "Товари" },
  { key: "orders_count", limitKey: "max_orders_per_month", label: "Замовлення / міс" },
  { key: "customers_count", limitKey: "max_customers", label: "Клієнти" },
];

export function UsageMeters({ summary, compact = false }: { summary: PlanSummary; compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {METRICS.map((m) => {
        const used = Number(summary.usage[m.key] ?? 0);
        const limit = summary.limits[m.limitKey];
        const isUnlimited = limit === null || limit === undefined;
        const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, Number(limit))) * 100));
        const danger = !isUnlimited && pct >= 90;
        const warn = !isUnlimited && pct >= 75 && pct < 90;
        return (
          <div key={m.key} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
              <span className={cn(
                "text-xs font-mono",
                danger && "text-destructive font-semibold",
                warn && "text-warning",
              )}>
                {used.toLocaleString()} / {isUnlimited ? "∞" : Number(limit).toLocaleString()}
              </span>
            </div>
            <Progress
              value={pct}
              className={cn(
                "mt-2 h-1.5",
                danger && "[&>div]:bg-destructive",
                warn && "[&>div]:bg-warning",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}
