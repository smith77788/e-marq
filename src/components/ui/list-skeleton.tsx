/**
 * ListSkeleton — placeholder for vertical list-shaped loading states
 * (customer rosters, memory rules, telegram recents, etc.).
 *
 * Renders N rows with avatar dot + two text lines, themed via design tokens.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ListSkeletonProps {
  rows?: number;
  showAvatar?: boolean;
  className?: string;
}

export function ListSkeleton({ rows = 4, showAvatar = true, className }: ListSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading…"
      aria-busy="true"
      className={cn("space-y-2", className)}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
        >
          {showAvatar && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-[55%]" />
            <Skeleton className="h-3 w-[35%]" />
          </div>
          <Skeleton className="h-5 w-12 shrink-0 rounded" />
        </div>
      ))}
    </div>
  );
}
