/**
 * TableSkeleton — placeholder for table-shaped loading states.
 *
 * Renders a fixed number of rows × columns of pulsing bars, sized to roughly
 * match the real table layout. Avoids the "blank flash → sudden table" UX.
 *
 * Use inside `<CardContent className="p-0">` next to a real `<Table>` so the
 * loading and loaded states share the same container width.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function TableSkeleton({ rows = 5, columns = 5, className }: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Завантаження…"
      aria-busy="true"
      className={cn("divide-y divide-border", className)}
    >
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-6 py-4">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-4", c === 0 ? "w-[28%]" : c === columns - 1 ? "w-[10%]" : "w-[16%]")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
