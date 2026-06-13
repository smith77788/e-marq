import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT, tStatic } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { NOINDEX_META } from "@/lib/seo";

type SignupSearch = {
  plan?: "free" | "starter" | "growth" | "scale";
  next?: "checkout";
};

const ALLOWED_PLANS = new Set(["free", "starter", "growth", "scale"]);

export const Route = createFileRoute("/signup")({
  validateSearch: (s: Record<string, unknown>): SignupSearch => ({
    plan:
      typeof s.plan === "string" && ALLOWED_PLANS.has(s.plan)
        ? (s.plan as SignupSearch["plan"])
        : undefined,
    next: s.next === "checkout" ? "checkout" : undefined,
  }),
  head: () => ({
    meta: [
      { title: `${tStatic("auth.signupTitle")} — MARQ` },
      { name: "description", content: tStatic("auth.signupDesc") },
      ...NOINDEX_META,
    ],
  }),
  component: SignupPage,
});

/**
 * Pricing → Signup → Pay (3 steps): if the user arrived from /pricing with a
 * plan, send them straight to /brand/billing?autopay=1&plan=… so the billing
 * page can immediately pre-select & confirm. Free plan / no plan → normal
 * /auth/callback → /dashboard flow.
 */
function postSignupDestination(search: SignupSearch): string {
  if (search.next === "checkout" && search.plan && search.plan !== "free") {
    return `/brand/billing?autopay=1&plan=${encodeURIComponent(search.plan)}`;
  }
  return "/auth/callback";
}

const PLAN_LABEL: Record<NonNullable<SignupSearch["plan"]>, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

function SignupPage() {
  const { t } = useT();
  const { signUp } = useAuth();
  const search = Route.useSearch();
  const [submitting, setSubmitting] = useState<"google" | "apple" | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const destination = postSignupDestination(search);
  const planLabel = search.plan ? PLAN_LABEL[search.plan as keyof typeof PLAN_LABEL] : null;
  const goingToCheckout = search.next === "checkout" && !!search.plan && search.plan !== "free";

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t("auth.passwordHint"));
      return;
    }
    setEmailSubmitting(true);
    try {
      // Persist funnel intent so it survives:
      //  (a) immediate signup w/ session  → /auth/callback reads it
      //  (b) email-confirm round-trip     → /auth/callback reads it after the
      //      user clicks the confirm link from their inbox.
      try {
        if (goingToCheckout) {
          window.sessionStorage.setItem("marq.postAuthDest", destination);
        } else {
          window.sessionStorage.removeItem("marq.postAuthDest");
        }
      } catch {
        /* storage may be blocked */
      }
      const result = await signUp(email, password, {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      });
      if (result.needsEmailConfirmation) {
        toast.success(t("auth.checkEmail"));
        setEmailSubmitting(false);
      } else {
        toast.success(t("auth.created"));
        window.location.assign(destination);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.failSignup"));
      setEmailSubmitting(false);
    }
  }

  async function onOAuth(provider: "google" | "apple") {
    setSubmitting(provider);
    try {
      // Persist desired destination across the OAuth round-trip.
      // /auth/callback will read this and finalize navigation.
      try {
        if (goingToCheckout) {
          window.sessionStorage.setItem("marq.postAuthDest", destination);
        } else {
          window.sessionStorage.removeItem("marq.postAuthDest");
        }
      } catch {
        /* storage may be blocked */
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        toast.error(
          error.message || t(provider === "apple" ? "auth.failSignupApple" : "auth.failSignupGoogle"),
        );
        setSubmitting(null);
      }
      // On success Supabase navigates to provider — no further action needed
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.failSignup"));
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
          {planLabel && goingToCheckout && (
            <Badge
              variant="outline"
              className="mb-2 w-fit border-primary/40 bg-primary/5 text-primary"
            >
              Крок 2 з 3 · обрано тариф {planLabel}
            </Badge>
          )}
          <CardTitle>{t("auth.signupTitle")}</CardTitle>
          <CardDescription>
            {goingToCheckout
              ? `Створіть акаунт — і ми одразу відкриємо оплату тарифу ${planLabel}.`
              : t("auth.signupDesc")}
          </CardDescription>
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
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={emailSubmitting || submitting}
              />
              <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
            </div>
            <Button type="submit" className="w-full" disabled={emailSubmitting || !!submitting}>
              {emailSubmitting ? t("auth.redirecting") : t("auth.signupBtn")}
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
              {submitting === "google" ? t("auth.redirecting") : t("auth.signupGoogle")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onOAuth("apple")}
              disabled={!!submitting || emailSubmitting}
            >
              <AppleIcon />
              {submitting === "apple" ? t("auth.redirecting") : t("auth.signupApple")}
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {t("auth.hasAccount")}{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              {t("auth.signin")}
            </Link>
          </p>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            {t("site.legal.agree")}{" "}
            <Link to="/terms" className="text-primary hover:underline">
              {t("site.legal.terms")}
            </Link>{" "}
            {t("site.legal.and")}{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              {t("site.legal.privacy")}
            </Link>
            .
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
