import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { NOINDEX_META } from "@/lib/seo";
import { readAndClearDest } from "@/lib/auth";

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

    // If the URL contains OAuth tokens, Supabase is still processing them
    // asynchronously. Subscribe to onAuthStateChange and wait — when Supabase
    // finishes it fires SIGNED_IN, which also updates useAuth (and triggers the
    // effect above). Use a direct subscription here as a belt-and-suspenders
    // measure so we don't miss the event if it fires before the hook re-renders.
    if (hasOAuthParams()) {
      let timeoutId: ReturnType<typeof setTimeout>;

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          clearTimeout(timeoutId);
          subscription.unsubscribe();
          doRedirect(readAndClearDest());
        }
      });

      // Fallback: if nothing happens in 10 s, give up
      timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        if (!redirected.current) window.location.replace("/login");
      }, 10_000);

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
