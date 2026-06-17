import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT, tStatic } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: `${tStatic("auth.newPasswordTitle")} — MARQ` },
      { name: "description", content: tStatic("auth.newPasswordDesc") },
      ...NOINDEX_META,
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useT();
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  // Supabase puts the recovery token into the URL hash. The auth client picks
  // it up and emits a PASSWORD_RECOVERY event — until then we don't allow the
  // user to submit a new password.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t("auth.passwordHint"));
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(password);
      toast.success(t("auth.newPasswordSaved"));
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
          <CardTitle>{t("auth.newPasswordTitle")}</CardTitle>
          <CardDescription>{t("auth.newPasswordDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
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
                disabled={submitting || !ready}
              />
              <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !ready}>
              {submitting ? t("auth.redirecting") : t("auth.newPasswordSave")}
            </Button>
          </form>
          <p className="text-center text-sm">
            <Link to="/login" search={{ error: undefined }} className="font-medium text-primary hover:underline">
              {t("auth.resetBack")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
