import { cn } from "@/lib/utils";

/**
 * Modern shimmer skeleton.
 * Default uses subtle shimmer overlay; pass `pulse` to fall back to old pulse style.
 */
function Skeleton({
  className,
  pulse = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { pulse?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md",
        pulse ? "animate-pulse bg-primary/10" : "shimmer",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
