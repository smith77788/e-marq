/**
 * ChartSkeleton — placeholder for chart areas (recharts containers).
 *
 * Mimics axis labels + bars/line area to avoid the "blank flash" before
 * recharts hydrates. Default height matches the typical 224px (h-56) used
 * across the app.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ChartSkeletonProps {
  variant?: "bars" | "line";
  className?: string;
  /** Height in tailwind units, e.g. "h-56" (default) or "h-48". */
  heightClassName?: string;
}

export function ChartSkeleton({
  variant = "bars",
  className,
  heightClassName = "h-56",
}: ChartSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Завантаження графіка…"
      aria-busy="true"
      className={cn("w-full", heightClassName, className)}
    >
      <div className="flex h-full w-full gap-3">
        {/* Y-axis ticks */}
        <div className="flex flex-col justify-between py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-2 w-6" />
          ))}
        </div>
        {/* Plot area */}
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1 overflow-hidden rounded-md bg-primary/5">
            {variant === "bars" ? (
              <div className="absolute inset-0 flex items-end gap-2 px-2 pb-1">
                {[0.7, 0.55, 0.4, 0.3, 0.22].map((h, i) => (
                  <Skeleton
                    key={i}
                    className="flex-1 rounded-t"
                    style={{ height: `${h * 100}%` }}
                  />
                ))}
              </div>
            ) : (
              <svg
                className="absolute inset-0 h-full w-full text-primary/25"
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 30 L15 22 L30 26 L45 14 L60 18 L75 8 L90 12 L100 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="animate-pulse"
                />
              </svg>
            )}
          </div>
          {/* X-axis ticks */}
          <div className="mt-2 flex justify-between">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-2 w-6" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
