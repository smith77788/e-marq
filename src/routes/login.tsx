import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT, tStatic } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: `${tStatic("auth.signinTitle")} — MARQ` },
      { name: "description", content: tStatic("auth.signinDesc") },
      ...NOINDEX_META,
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useT();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, user, navigate]);

  async function onGoogle() {
    setSubmitting(true);
    try {
      // Send the user back directly to /dashboard after the OAuth round-trip.
      // Using window.location.origin would land them on "/" where a second
      // client-side redirect is needed — that race caused repeated logins
      // ("nothing happens after sign-in") on desktop.
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/dashboard`,
      });
      if (result.redirected) return; // full-page redirect to Google in flight

      if (result.error) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          // Hard reload — guarantees the auth context picks up the new
          // session before the protected route guard runs.
          window.location.assign("/dashboard");
          return;
        }
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        if (!/cancel/i.test(msg)) {
          toast.error(msg || t("auth.failGoogle"));
        }
        setSubmitting(false);
        return;
      }

      toast.success(t("auth.welcome"));
      // Hard navigate to avoid a race between setSession() and the
      // _authenticated guard reading a stale user=null.
      window.location.assign("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.fail"));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.signinTitle")}</CardTitle>
          <CardDescription>{t("auth.signinDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onGoogle}
            disabled={submitting}
          >
            <GoogleIcon />
            {submitting ? t("auth.redirecting") : t("auth.continueGoogle")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("auth.noAccount")}{" "}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              {t("auth.create")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.5 6.6 2.5 12s4.2 9.6 9.5 9.6c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
