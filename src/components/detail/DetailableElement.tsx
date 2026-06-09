/**
 * DetailableElement — wraps any existing element and turns it into a
 * "click to open detail drawer" surface, without modifying the inner JSX.
 *
 * Behaviour
 *  - Click on the wrapper opens the drawer.
 *  - Clicks on interactive descendants (a, button, input, [role="button"],
 *    [data-stop-detail]) DO NOT open the drawer. We detect this via
 *    `event.target.closest(...)`.
 *  - Hover after 300ms triggers prefetch via React Query.
 *  - Keyboard: Enter/Space open the drawer (role="button", tabIndex=0).
 *  - Subtle hover effect: scale(1.01) + accent ring.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useOptionalDetailController } from "./DetailController";
import { detailQueryKey } from "./useDetailData";
import type { DetailHandle, DetailPayload, DrawerSize, ResourceType } from "./types";

const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [data-stop-detail]';

type Props = {
  elementId: string;
  resourceType: ResourceType;
  drawerTitle?: string;
  drawerSize?: DrawerSize;
  /** Async loader. Either this OR `payload` is required. */
  fetchDetail?: () => Promise<DetailPayload>;
  /** Eager payload. */
  payload?: DetailPayload;
  /** Stale time in ms; default 30s for "live", pass 5*60_000 for static. */
  staleTime?: number;
  className?: string;
  children: React.ReactNode;
  /** Disable wrapper behaviour but still render children (for conditional usage). */
  disabled?: boolean;
  /** A11y label for screen readers describing what the drawer will show. */
  ariaLabel?: string;
};

export function DetailableElement({
  elementId,
  resourceType,
  drawerTitle,
  drawerSize = "md",
  fetchDetail,
  payload,
  staleTime = 30_000,
  className,
  children,
  disabled,
  ariaLabel,
}: Props) {
  const ctrl = useOptionalDetailController();
  const queryClient = useQueryClient();
  const hoverTimer = React.useRef<number | null>(null);

  // Register so that ?detail=type:id can rehydrate on load / popstate.
  React.useEffect(() => {
    if (!ctrl || disabled) return;
    return ctrl.register(resourceType, elementId, {
      fetchDetail,
      payload,
      drawerTitle,
      drawerSize,
    });
  }, [ctrl, disabled, resourceType, elementId, fetchDetail, payload, drawerTitle, drawerSize]);

  const buildHandle = React.useCallback(
    (): DetailHandle => ({
      resourceType,
      elementId,
      drawerTitle,
      drawerSize,
      fetchDetail,
      payload,
    }),
    [resourceType, elementId, drawerTitle, drawerSize, fetchDetail, payload],
  );

  const openDrawer = React.useCallback(() => {
    if (!ctrl || disabled) return;
    ctrl.open(buildHandle());
  }, [ctrl, disabled, buildHandle]);

  const onClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return; // child handled it
      // Ignore text-selection drags
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (sel && sel.toString().length > 0) return;
      openDrawer();
    },
    [disabled, openDrawer],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.target !== e.currentTarget) return; // focus is inside an interactive child
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDrawer();
      }
    },
    [disabled, openDrawer],
  );

  const prefetch = React.useCallback(() => {
    if (!fetchDetail || disabled) return;
    void queryClient.prefetchQuery({
      queryKey: detailQueryKey(resourceType, elementId),
      queryFn: fetchDetail,
      staleTime,
    });
  }, [fetchDetail, disabled, queryClient, resourceType, elementId, staleTime]);

  const onMouseEnter = React.useCallback(() => {
    if (disabled) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(prefetch, 300);
  }, [disabled, prefetch]);

  const onMouseLeave = React.useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);

  React.useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, []);

  if (disabled || !ctrl) {
    // Graceful fallback — render children untouched if no provider exists.
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? drawerTitle ?? "Відкрити деталі"}
      aria-haspopup="dialog"
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={prefetch}
      data-detailable={`${resourceType}:${elementId}`}
      className={cn(
        // Behaviour
        "group relative cursor-pointer outline-none",
        "transition-transform duration-200 ease-out",
        "hover:scale-[1.01] focus-visible:scale-[1.01]",
        // Accent ring on hover/focus, themed via design tokens
        "rounded-[inherit]",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit]",
        "before:ring-1 before:ring-transparent before:transition-[box-shadow,ring-color] before:duration-200",
        "hover:before:ring-primary/40 focus-visible:before:ring-primary/60",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {children}
    </div>
  );
}
