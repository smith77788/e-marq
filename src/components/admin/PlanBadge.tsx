import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PLAN_STYLES: Record<string, string> = {
  free: "border-muted-foreground/40 text-muted-foreground",
  starter: "border-primary/40 text-primary bg-primary/5",
  growth: "border-success/40 text-success bg-success/5",
  scale: "border-accent/40 text-accent bg-accent/10",
  enterprise: "border-warning/40 text-warning bg-warning/5",
};

export function PlanBadge({ planKey, planName, className }: {
  planKey: string;
  planName?: string;
  className?: string;
}) {
  const style = PLAN_STYLES[planKey] ?? PLAN_STYLES.free;
  return (
    <Badge variant="outline" className={cn(style, "uppercase text-[10px] font-semibold tracking-wide", className)}>
      {planName ?? planKey}
    </Badge>
  );
}
