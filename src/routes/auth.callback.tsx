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

    if (user) {
      window.location.replace("/dashboard");
      return;
    }

    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;

      if (data.session?.user) {
        window.location.replace("/dashboard");
        return;
      }

      window.location.replace("/login");
    });

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