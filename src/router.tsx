import { createRouter, useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { routeTree } from "./routeTree.gen";
import { useT } from "@/lib/i18n";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const { t } = useT();

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t("err.boundary.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("err.boundary.desc")}</p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("err.boundary.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("err.boundary.home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    // Prefetch route chunks + loader on hover/focus → instant navigation.
    // Default 50ms intent delay avoids over-fetching when user just passes by.
    defaultPreload: "intent",
    // Reuse preloaded loader data for 30s before re-fetching on actual nav.
    defaultPreloadStaleTime: 30_000,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
