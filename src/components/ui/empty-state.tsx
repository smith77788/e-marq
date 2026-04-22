/**
 * EmptyState — універсальний placeholder для списків/таблиць без даних.
 *
 * Замість сирого `<p>Немає даних</p>` дає послідовний візуальний компонент
 * з іконкою, заголовком, описом і опціональним CTA.
 *
 * Варіанти:
 *  - "card"    (default) — рамка з фоном, для самостійних блоків
 *  - "inline"  — без рамки, для use-кейсів усередині уже існуючої картки
 *  - "compact" — мінімальна висота, для inline списків (dropdowns, sheets)
 *
 * Використання:
 *   <EmptyState
 *     icon={Package}
 *     title="Поки що без продуктів"
 *     description="Додайте перший продукт, щоб почати продавати."
 *     action={<Button onClick={...}>Додати</Button>}
 *   />
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "card" | "inline" | "compact";
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = "card",
  className,
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const wrapperClass = cn(
    "flex flex-col items-center justify-center gap-3 text-center",
    variant === "card" &&
      "rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10",
    variant === "inline" && "px-4 py-8",
    isCompact && "px-3 py-6",
    className,
  );

  return (
    <div role="status" aria-live="polite" className={wrapperClass}>
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          isCompact ? "h-9 w-9" : "h-12 w-12",
        )}
        aria-hidden="true"
      >
        <Icon className={isCompact ? "h-4 w-4" : "h-5 w-5"} />
      </div>
      <div className="space-y-1">
        <p
          className={cn(
            "font-medium text-foreground",
            isCompact ? "text-sm" : "text-base",
          )}
        >
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "mx-auto max-w-sm text-muted-foreground",
              isCompact ? "text-xs" : "text-sm",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
