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

    if (user) {
      window.location.replace(readAndClearDest() ?? "/dashboard");
      return;
    }

    // Check if Supabase is configured before trying to use it
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      // Supabase not configured — redirect to login with error
      window.location.replace("/login?error=supabase_not_configured");
      return;
    }

    let cancelled = false;

    void supabase.auth.getSession().then(
      ({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          window.location.replace(readAndClearDest() ?? "/dashboard");
          return;
        }
        window.location.replace("/login");
      },
      () => {
        if (!cancelled) window.location.replace("/login");
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
