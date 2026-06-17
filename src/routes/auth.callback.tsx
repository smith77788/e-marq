import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
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

function readAndClearDest(): string {
  try {
    const dest = window.sessionStorage.getItem("marq.postAuthDest");
    if (dest) {
      window.sessionStorage.removeItem("marq.postAuthDest");
      if (dest.startsWith("/") && !dest.startsWith("//")) return dest;
    }
  } catch {
    /* storage may be blocked */
  }
  return "/dashboard";
}

/** True when the URL contains OAuth response params (hash or query). */
function hasOAuthParams(): boolean {
  const hash = window.location.hash;
  const search = window.location.search;
  return (
    hash.includes("access_token") ||
    hash.includes("refresh_token") ||
    new URLSearchParams(search).has("code") ||
    new URLSearchParams(search).has("access_token")
  );
}

function AuthCallbackPage() {
  const { user, loading } = useAuth();
  const { t } = useT();
  const redirected = useRef(false);

  // Check if Supabase is configured at all
  const supabaseConfigured = !!(
    import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  ) && !!(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  );

  function doRedirect(dest?: string) {
    if (redirected.current) return;
    redirected.current = true;
    window.location.replace(dest ?? readAndClearDest());
  }

  // Fast path: useAuth already has a session (re-renders after onAuthStateChange)
  useEffect(() => {
    if (user) doRedirect(readAndClearDest());
  }, [user]);

  useEffect(() => {
    if (loading) return;

    // If user is already known, fast path above handles it
    if (user) return;

    // If Supabase is not configured, redirect immediately
    if (!supabaseConfigured) {
      doRedirect("/login");
      return;
    }

    // If the URL contains OAuth tokens, Supabase is still processing them
    if (hasOAuthParams()) {
      let timeoutId: ReturnType<typeof setTimeout>;

      // Log for debugging
      console.log("[auth/callback] OAuth params detected, waiting for Supabase...");

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log("[auth/callback] Auth state change:", event, !!session?.user);
        if (event === "SIGNED_IN" && session?.user) {
          clearTimeout(timeoutId);
          subscription.unsubscribe();
          doRedirect(readAndClearDest());
        }
      });

      // Fallback: if nothing happens in 8 s, give up
      timeoutId = setTimeout(() => {
        console.warn("[auth/callback] Timeout — no auth state change after 8s");
        subscription.unsubscribe();
        if (!redirected.current) {
          // Show error before redirect
          window.location.replace("/login?error=auth_timeout");
        }
      }, 8_000);

      return () => {
        clearTimeout(timeoutId);
        subscription.unsubscribe();
      };
    }

    // No OAuth params in URL — just check if there's already a stored session
    let cancelled = false;

    void supabase.auth.getSession().then(
      ({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          doRedirect(readAndClearDest());
        } else {
          window.location.replace("/login");
        }
      },
      () => {
        setTimeout(() => {
          if (!cancelled && !redirected.current) window.location.replace("/login");
        }, 1_000);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [loading, user, supabaseConfigured]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground">MARQ</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.redirecting")}</p>
      </div>
    </main>
  );
}
