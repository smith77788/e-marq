import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning" | "destructive" | "info";
  trend?: { value: number; label?: string } | null;
};

const TONE_RING: Record<NonNullable<Props["tone"]>, string> = {
  primary: "from-primary/30 via-primary/5 to-transparent ring-primary/30",
  success: "from-success/30 via-success/5 to-transparent ring-success/30",
  warning: "from-warning/30 via-warning/5 to-transparent ring-warning/30",
  destructive: "from-destructive/30 via-destructive/5 to-transparent ring-destructive/30",
  info: "from-accent/30 via-accent/5 to-transparent ring-accent/30",
};

const ICON_TONE: Record<NonNullable<Props["tone"]>, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-accent",
};

export function MissionStatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  trend,
}: Props) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/60 bg-card/70 p-4 ring-1 backdrop-blur transition-all hover:scale-[1.01] hover:shadow-glow",
        "ring-border/40",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-1/2 -right-1/3 h-48 w-48 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity group-hover:opacity-100",
          TONE_RING[tone],
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/60 ring-1 ring-border/60",
            ICON_TONE[tone],
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {trend && (
        <div className="relative mt-3 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
              trend.value >= 0
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {trend.value >= 0 ? "▲" : "▼"} {Math.abs(trend.value).toFixed(1)}%
          </span>
          {trend.label && <span className="text-muted-foreground">{trend.label}</span>}
        </div>
      )}
    </div>
  );
}
