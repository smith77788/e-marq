import { Skeleton } from "@/components/ui/skeleton";

/**
 * Modern cockpit loading state.
 * - Top progress bar (perceived speed)
 * - Hero shimmer block
 * - Stat row + grid
 * - Stagger fade-in via parent .reveal-stagger
 */
export function CockpitSkeleton({
  variant = "owner",
}: {
  variant?: "owner" | "admin";
}) {
  return (
    <>
      <div className="top-progress" aria-hidden="true" />
      <div className="reveal-stagger space-y-6" aria-busy="true" aria-label="Завантаження кокпіту">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/5 via-card/40 to-accent/5 p-6">
          <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-3">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-28" />
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-24" />
              <Skeleton className="mt-2 h-3 w-16" />
            </div>
          ))}
        </div>

        {variant === "admin" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-72 rounded-xl lg:col-span-2" />
              <Skeleton className="h-72 rounded-xl" />
            </div>
            <Skeleton className="h-56 rounded-xl" />
          </>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-64 rounded-xl lg:col-span-2" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
            <Skeleton className="h-40 rounded-xl" />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Per-section reveal wrapper — smoothly fades content in once data is ready,
 * without flashing layout. Use around heavy widgets that mount independently.
 */
export function SectionReveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={`fade-in-soft ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
