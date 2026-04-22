import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

export type TenantLeaderRow = {
  id: string;
  name: string;
  slug: string;
  revenueCents: number;
  orders: number;
  insights: number;
  agentRuns: number;
  status: string;
};

type Props = {
  rows: TenantLeaderRow[];
};

export function TenantLeaderboard({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 p-8 text-center text-sm text-muted-foreground">
        Поки що немає брендів. Створіть перший — тут зʼявиться лідерборд.
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.revenueCents), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((row, idx) => {
        const pct = (row.revenueCents / max) * 100;
        const isTop = idx === 0;
        return (
          <li key={row.id}>
            <Link
              to="/admin/tenants/$tenantId"
              params={{ tenantId: row.id }}
              className="group relative block overflow-hidden rounded-lg border border-border/60 bg-card/40 p-3 transition-all hover:border-primary/40 hover:bg-card/70 hover:shadow-glow"
            >
              <div
                className={cn(
                  "absolute inset-y-0 left-0 bg-gradient-to-r transition-opacity",
                  isTop
                    ? "from-primary/25 via-primary/10 to-transparent"
                    : "from-accent/15 via-accent/5 to-transparent",
                )}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums",
                    isTop
                      ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                      : "bg-muted/60 text-muted-foreground ring-1 ring-border/60",
                  )}
                >
                  {isTop ? <Crown className="h-3.5 w-3.5" /> : idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{row.name}</p>
                    <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      /{row.slug}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {row.orders} замовл. · {row.insights} підказок · {row.agentRuns} запусків
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums text-foreground">
                    {formatMoney(row.revenueCents)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">виторг</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
