import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Авторизація — MARQ" },
      { name: "description", content: "Завершення авторизації." },
      ...NOINDEX_META,
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const { user, loading } = useAuth();
  const { t } = useT();

  useEffect(() => {
    if (loading) return;

    // Honor a one-shot post-auth destination set by /signup or /login when the
    // user came in from a Pricing CTA. Collapses the funnel to 3 steps.
    function readAndClearDest(): string | null {
      try {
        const dest = window.sessionStorage.getItem("marq.postAuthDest");
        if (dest) {
          window.sessionStorage.removeItem("marq.postAuthDest");
          if (dest.startsWith("/") && !dest.startsWith("//")) return dest;
        }
      } catch {
        /* storage may be blocked */
      }
      return null;
    }

    // If user is already set (from Lovable proxy or Supabase), redirect to dashboard
    if (user) {
      window.location.replace(readAndClearDest() ?? "/dashboard");
      return;
    }

    // Try to get session from Supabase (might be set by Lovable proxy)
    let cancelled = false;

    void supabase.auth.getSession().then(
      ({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          window.location.replace(readAndClearDest() ?? "/dashboard");
          return;
        }
        // No session — redirect to login
        window.location.replace("/login");
      },
      () => {
        // Error getting session — might be Lovable proxy callback
        // Give it a moment for the session to propagate
        setTimeout(() => {
          if (!cancelled) {
            // Check if user was set in the meantime
            window.location.replace("/login");
          }
        }, 2000);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground">MARQ</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.redirecting")}</p>
      </div>
    </main>
  );
}
