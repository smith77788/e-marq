/**
 * MfaSetupCard — TOTP enroll/verify/unenroll UI for /profile Security tab.
 * Uses Supabase Auth MFA primitives (no extra tables, no RLS work needed).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Shield, ShieldCheck, ShieldOff, Smartphone, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

type EnrollState =
  | { phase: "idle" }
  | {
      phase: "enrolling";
      factorId: string;
      qr: string;
      secret: string;
      code: string;
      verifying: boolean;
    };

export function MfaSetupCard() {
  const { t } = useT();
  const qc = useQueryClient();
  const [enroll, setEnroll] = useState<EnrollState>({ phase: "idle" });
  const [removing, setRemoving] = useState(false);

  const factorsQuery = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      // verified totp factors only
      return (data?.totp ?? []).filter((f) => f.status === "verified");
    },
  });

  const activeFactor = factorsQuery.data?.[0] ?? null;
  const hasActive = !!activeFactor;

  // Cleanup an in-progress unverified enrollment if user navigates away mid-flow.
  useEffect(() => {
    return () => {
      if (enroll.phase === "enrolling") {
        void supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
      }
    };
    // intentionally only on factorId change
  }, [enroll.phase === "enrolling" ? enroll.factorId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startEnroll() {
    try {
      const friendlyName = `MARQ · ${new Date().toISOString().slice(0, 10)}`;
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
      });
      if (error) throw error;
      if (!data) throw new Error("No enrollment payload");
      setEnroll({
        phase: "enrolling",
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
        code: "",
        verifying: false,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enroll failed");
    }
  }

  async function cancelEnroll() {
    if (enroll.phase !== "enrolling") return;
    try {
      await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    } catch {
      // ignore — best-effort cleanup
    } finally {
      setEnroll({ phase: "idle" });
    }
  }

  async function verifyEnroll() {
    if (enroll.phase !== "enrolling") return;
    if (enroll.code.length !== 6) return;
    setEnroll({ ...enroll, verifying: true });
    try {
      const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({
        factorId: enroll.factorId,
      });
      if (chalErr) throw chalErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: chal.id,
        code: enroll.code,
      });
      if (vErr) throw new Error(t("mfa.invalidCode"));
      toast.success(t("mfa.enrollSuccess"));
      setEnroll({ phase: "idle" });
      await qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("mfa.invalidCode"));
      setEnroll((prev) => (prev.phase === "enrolling" ? { ...prev, verifying: false } : prev));
    }
  }

  async function removeFactor() {
    if (!activeFactor) return;
    setRemoving(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: activeFactor.id });
      if (error) throw error;
      toast.success(t("mfa.removeSuccess"));
      await qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRemoving(false);
    }
  }

  const addedDate = useMemo(() => {
    if (!activeFactor?.created_at) return "";
    try {
      return new Date(activeFactor.created_at).toLocaleDateString();
    } catch {
      return "";
    }
  }, [activeFactor?.created_at]);

  return (
    <Card className="border-info/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Shield className="h-4 w-4 text-info" />
          {t("mfa.title")}
          {hasActive ? (
            <Badge className="border-success/40 bg-success/10 text-success" variant="outline">
              <ShieldCheck className="mr-1 h-3 w-3" /> {t("mfa.statusOn")}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
              <ShieldOff className="mr-1 h-3 w-3" /> {t("mfa.statusOff")}
            </Badge>
          )}
          <Badge variant="outline" className="border-warning/40 bg-warning/5 text-warning">
            {t("mfa.recommendBadge")}
          </Badge>
        </CardTitle>
        <CardDescription>{t("mfa.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {factorsQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : hasActive ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-success" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t("mfa.activeFactor").replace(
                    "{name}",
                    activeFactor.friendly_name || "Authenticator",
                  )}
                </p>
                {addedDate && (
                  <p className="text-xs text-muted-foreground">
                    {t("mfa.addedAt").replace("{date}", addedDate)}
                  </p>
                )}
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-destructive">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("mfa.disableBtn")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("mfa.removeConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("mfa.removeConfirmDesc")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("mfa.cancelEnroll")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void removeFactor()}
                    disabled={removing}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {removing ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {t("mfa.removeConfirmBtn")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : enroll.phase === "idle" ? (
          <div className="flex justify-end">
            <Button onClick={() => void startEnroll()}>
              <Shield className="mr-1.5 h-4 w-4" />
              {t("mfa.enableBtn")}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">{t("mfa.scanTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("mfa.scanDesc")}</p>
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-start">
                <img
                  src={enroll.qr}
                  alt="TOTP QR"
                  className="h-40 w-40 rounded bg-white p-2"
                />
                <div className="flex-1 space-y-1 text-center sm:text-left">
                  <p className="text-xs text-muted-foreground">{t("mfa.manualKey")}</p>
                  <code className="block break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">
                    {enroll.secret}
                  </code>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">{t("mfa.verifyTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("mfa.verifyDesc")}</p>
              <div className="flex justify-center py-2">
                <InputOTP
                  maxLength={6}
                  value={enroll.code}
                  onChange={(v) =>
                    setEnroll((prev) =>
                      prev.phase === "enrolling" ? { ...prev, code: v.replace(/\D/g, "") } : prev,
                    )
                  }
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
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => void cancelEnroll()}>
                  {t("mfa.cancelEnroll")}
                </Button>
                <Button
                  onClick={() => void verifyEnroll()}
                  disabled={enroll.code.length !== 6 || enroll.verifying}
                >
                  {enroll.verifying ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                  )}
                  {t("mfa.verifyBtn")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
