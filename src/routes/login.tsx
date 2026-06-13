import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  const { user, loading, signIn } = useAuth();
  const { t } = useT();
  const [submitting, setSubmitting] = useState(false);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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

  useEffect(() => {
    if (!loading && user) {
      window.location.assign(readAndClearDest());
    }
  }, [loading, user]);

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error(t("auth.email") + " + " + t("auth.password"));
      return;
    }
    setEmailSubmitting(true);
    try {
      await signIn(email, password);
      toast.success(t("auth.welcome"));
      window.location.assign(readAndClearDest());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.fail"));
      setEmailSubmitting(false);
    }
  }

  async function onGoogle() {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        toast.error(error.message || t("auth.failGoogle"));
        setSubmitting(false);
      }
      // On success Supabase navigates to Google — no further action needed
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
          <form onSubmit={onEmailSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={emailSubmitting || submitting}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={emailSubmitting || submitting}
              />
            </div>
            <Button type="submit" className="w-full" disabled={emailSubmitting || submitting}>
              {emailSubmitting ? t("auth.redirecting") : t("auth.signinBtn")}
            </Button>
          </form>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wider text-muted-foreground">
              {t("auth.or")}
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onGoogle}
            disabled={submitting || emailSubmitting}
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
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            <Link to="/terms" className="text-primary hover:underline">
              {t("site.legal.terms")}
            </Link>
            {" · "}
            <Link to="/privacy" className="text-primary hover:underline">
              {t("site.legal.privacy")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.5 6.6 2.5 12s4.2 9.6 9.5 9.6c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
