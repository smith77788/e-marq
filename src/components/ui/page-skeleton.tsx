/**
 * PageSkeleton — generic placeholder used for top-level page loading guards
 * (e.g. while tenant context resolves). Mimics a header + a card stack so the
 * layout does not collapse to a single "Завантаження…" line.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface PageSkeletonProps {
  /** Number of card-shaped blocks to render. Default 3. */
  blocks?: number;
  className?: string;
}

export function PageSkeleton({ blocks = 3, className }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading…"
      aria-busy="true"
      className={cn("space-y-6", className)}
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: blocks }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-5"
          >
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
