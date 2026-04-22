/**
 * MfaChallengeGate — wraps the authenticated app and forces TOTP verification
 * when the user has at least one verified factor but the current session is
 * still aal1 (password only). Until they verify, no children render.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LogOut, Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function MfaChallengeGate({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const { signOut, session } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const aalQuery = useQuery({
    queryKey: ["aal", session?.access_token ?? null],
    enabled: !!session,
    queryFn: async () => {
      const [aalRes, factorsRes] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      const factor = (factorsRes.data?.totp ?? []).find((f) => f.status === "verified") ?? null;
      return {
        currentLevel: aalRes.data?.currentLevel ?? null,
        nextLevel: aalRes.data?.nextLevel ?? null,
        factor,
      };
    },
  });

  const requiresChallenge =
    !!aalQuery.data?.factor &&
    aalQuery.data.currentLevel === "aal1" &&
    aalQuery.data.nextLevel === "aal2";

  // Reset OTP input when prompt becomes visible
  useEffect(() => {
    if (requiresChallenge) setCode("");
  }, [requiresChallenge]);

  async function submit() {
    const factor = aalQuery.data?.factor;
    if (!factor || code.length !== 6) return;
    setVerifying(true);
    try {
      const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (chalErr) throw chalErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: chal.id,
        code,
      });
      if (vErr) throw new Error(t("mfa.invalidCode"));
      toast.success(t("mfa.gateSuccess"));
      await qc.invalidateQueries({ queryKey: ["aal"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("mfa.invalidCode"));
      setCode("");
    } finally {
      setVerifying(false);
    }
  }

  if (aalQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!requiresChallenge) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-info/30">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-info/10 text-info">
            <Shield className="h-6 w-6" />
          </div>
          <CardTitle className="mt-3">{t("mfa.gateTitle")}</CardTitle>
          <CardDescription>{t("mfa.gateDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(v: string) => setCode(v.replace(/\D/g, ""))}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button
            className="w-full"
            onClick={() => void submit()}
            disabled={code.length !== 6 || verifying}
          >
            {verifying ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 h-4 w-4" />
            )}
            {t("mfa.gateSubmit")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            {t("mfa.gateSignOut")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
