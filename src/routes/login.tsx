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
  validateSearch: (s: Record<string, unknown>) => ({
    error: typeof s.error === "string" ? s.error : undefined,
  }),
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
  const search = Route.useSearch();
  const [submitting, setSubmitting] = useState<"google" | "apple" | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Show error if Supabase is not configured
  const configError = search.error === "supabase_not_configured";

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

  async function onOAuth(provider: "google" | "apple") {
    setSubmitting(provider);
    try {
      // Check if Supabase is configured
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
      
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        // Try Lovable proxy only (it may work without Supabase env vars)
        try {
          const { lovable } = await import("@/integrations/lovable");
          const result = await lovable.auth.signInWithOAuth(provider, {
            redirect_uri: `${window.location.origin}/auth/callback`,
          });
          if (result.redirected) return;
          if (!result.error) {
            window.location.assign("/auth/callback");
            return;
          }
        } catch {
          // Lovable proxy unavailable
        }
        // Neither Lovable nor Supabase configured
        toast.error("Авторизація через Google тимчасово недоступна. Увійдіть через email.");
        setSubmitting(null);
        return;
      }

      // Try Lovable proxy first (works on lovable.app without any env config).
      // Dynamic import so a proxy init failure doesn't crash the page on load.
      let lovableDone = false;
      try {
        const { lovable } = await import("@/integrations/lovable");
        const result = await lovable.auth.signInWithOAuth(provider, {
          redirect_uri: `${window.location.origin}/auth/callback`,
        });
        if (result.redirected) return; // browser navigated — we're done

        if (!result.error) {
          // Proxy set the session directly (popup flow)
          window.location.assign("/auth/callback");
          return;
        }
        // Proxy returned error — check if session was somehow set anyway
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          window.location.assign("/auth/callback");
          return;
        }
        lovableDone = true; // explicit error, fall through to Supabase direct
      } catch {
        lovableDone = true; // proxy unavailable, fall through
      }

      if (lovableDone) {
        // Fallback: direct Supabase OAuth (requires Google/Apple configured in Supabase dashboard)
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) {
          toast.error(error.message || t(provider === "apple" ? "auth.failApple" : "auth.failGoogle"));
          setSubmitting(null);
        }
        // On success Supabase navigates — no further action needed
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.fail"));
      setSubmitting(null);
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
          {configError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              Сервіс тимчасово недоступний. Спробуйте увійти через email та пароль або зверніться до підтримки.
            </div>
          )}
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
                disabled={emailSubmitting || !!submitting}
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
                disabled={emailSubmitting || !!submitting}
              />
            </div>
            <Button type="submit" className="w-full" disabled={emailSubmitting || !!submitting}>
              {emailSubmitting ? t("auth.redirecting") : t("auth.signinBtn")}
            </Button>
          </form>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wider text-muted-foreground">
              {t("auth.or")}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onOAuth("google")}
              disabled={!!submitting || emailSubmitting}
            >
              <GoogleIcon />
              {submitting === "google" ? t("auth.redirecting") : t("auth.continueGoogle")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onOAuth("apple")}
              disabled={!!submitting || emailSubmitting}
            >
              <AppleIcon />
              {submitting === "apple" ? t("auth.redirecting") : t("auth.continueApple")}
            </Button>
          </div>
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

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4 fill-current" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.42.07 2.41.74 3.24.8 1.23-.25 2.41-.96 3.72-.84 1.59.18 2.8.83 3.56 2.07-3.26 2.02-2.6 6.3.48 7.9-.57 1.37-1.3 2.73-3 2.95zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
