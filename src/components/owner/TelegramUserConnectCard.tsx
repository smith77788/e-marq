/**
 * TelegramUserConnectCard — підключення ОСОБИСТОГО Telegram-акаунту власника
 * через MTProto bridge (gramjs/Telethon, розгорнутий окремо).
 *
 * Login flow: phone → SMS/in-app code → (опц.) 2FA password → активна сесія.
 * Усі дії виконуються через серверні роути /api/telegram/user/*.
 *
 * UWAGA: цей акаунт виконує user-level дії (DM, коменти, реакції, скарги) —
 * не плутати з ботом (TelegramConnectCard).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  ShieldAlert,
  Smartphone,
  UserRound,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

type UserStatus = {
  bridge_ready: boolean;
  status: "none" | "code_sent" | "password_required" | "active" | "expired" | "logged_out" | string;
  alive: boolean | null;
  phone: string | null;
  user_id: number | null;
  username: string | null;
  first_name: string | null;
  dc_id: number | null;
  last_used_at: string | null;
  hint: string | null;
};

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Спочатку увійдіть у кабінет");
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });
}

type Props = { tenantId: string };

export function TelegramUserConnectCard({ tenantId }: Props) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const status = useQuery({
    queryKey: ["telegram-user-status", tenantId],
    queryFn: async (): Promise<UserStatus> => {
      const r = await authedFetch(`/api/telegram/user/status?tenant=${tenantId}`);
      const j = (await r.json().catch(() => ({}))) as UserStatus & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    refetchInterval: (q) => (q.state.data?.status === "active" ? 60_000 : 15_000),
    staleTime: 10_000,
  });

  const sendCodeM = useMutation({
    mutationFn: async () => {
      const r = await authedFetch(`/api/telegram/user/send-code`, {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, phone: phone.trim() }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
    },
    onSuccess: () => {
      toast.success("Код надіслано в Telegram", {
        description: "Введіть 5-значний код, який прийшов у застосунок або SMS.",
      });
      qc.invalidateQueries({ queryKey: ["telegram-user-status", tenantId] });
    },
    onError: (e: Error) => toast.error("Не вдалося надіслати код", { description: e.message }),
  });

  const signInM = useMutation({
    mutationFn: async () => {
      const r = await authedFetch(`/api/telegram/user/sign-in`, {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          code: code.trim(),
          password: password ? password : undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      if (j.error === "password_required") return { needsPassword: true } as const;
      return { needsPassword: false } as const;
    },
    onSuccess: (res) => {
      if (res.needsPassword) {
        toast.message("Потрібен пароль 2FA", {
          description: "Введіть пароль хмарного захисту Telegram і натисніть «Увійти» ще раз.",
        });
      } else {
        toast.success("Telegram-акаунт підключено");
        setCode("");
        setPassword("");
      }
      qc.invalidateQueries({ queryKey: ["telegram-user-status", tenantId] });
    },
    onError: (e: Error) => toast.error("Не вдалося увійти", { description: e.message }),
  });

  const logoutM = useMutation({
    mutationFn: async () => {
      const r = await authedFetch(`/api/telegram/user/status`, {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, action: "logout" }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    },
    onSuccess: () => {
      toast.success("Сесію Telegram завершено");
      setPhone("");
      setCode("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["telegram-user-status", tenantId] });
    },
    onError: (e: Error) => toast.error("Не вдалося вийти", { description: e.message }),
  });

  const data = status.data;
  const isActive = data?.status === "active";
  const needsPassword = data?.status === "password_required";
  const codeSent = data?.status === "code_sent" || needsPassword;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4 text-primary" />
          Особистий Telegram-акаунт
        </CardTitle>
        <CardDescription>
          Підключіть свій акаунт, щоб агенти могли коментувати, ставити реакції, писати в DM та
          надсилати скарги — від вашого імені, в межах безпечних квот.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data?.bridge_ready && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <div>
              MTProto-міст ще не активний. Розгорніть Node-сервіс (gramjs) і додайте секрети
              <code className="mx-1">TG_MTPROTO_BRIDGE_URL</code>,{" "}
              <code className="mx-1">TG_MTPROTO_BRIDGE_SECRET</code>,{" "}
              <code className="mx-1">TG_SESSION_ENC_KEY</code>. До цього моменту форма входу буде
              недоступна.
            </div>
          </div>
        )}

        {status.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Перевіряю стан акаунту…
          </div>
        ) : isActive ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-success/40 bg-success/10 text-success">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Активна сесія
              </Badge>
              <span className="text-sm font-medium text-foreground">
                {data?.first_name ?? "Telegram"}{" "}
                {data?.username && (
                  <a
                    href={`https://t.me/${data.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 text-primary hover:underline"
                  >
                    @{data.username}
                  </a>
                )}
              </span>
              {data?.alive === false && (
                <Badge variant="outline" className="border-warning/40 text-warning">
                  потрібна перевірка
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {data?.phone ? `Телефон: ${data.phone}. ` : ""}
              {data?.last_used_at
                ? `Остання дія: ${new Date(data.last_used_at).toLocaleString("uk-UA")}.`
                : "Поки що жодних дій не було."}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={logoutM.isPending}
              onClick={() => logoutM.mutate()}
            >
              {logoutM.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
              )}
              Завершити сесію
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!codeSent && (
              <div className="space-y-2">
                <Label htmlFor="tg-phone" className="text-xs">
                  Номер телефону (з кодом країни)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="tg-phone"
                    type="tel"
                    placeholder="+380501234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={!data?.bridge_ready || sendCodeM.isPending}
                  />
                  <Button
                    onClick={() => sendCodeM.mutate()}
                    disabled={!data?.bridge_ready || sendCodeM.isPending || phone.length < 7}
                  >
                    {sendCodeM.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Smartphone className="mr-1.5 h-4 w-4" />
                    )}
                    Надіслати код
                  </Button>
                </div>
              </div>
            )}

            {codeSent && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Smartphone className="h-3.5 w-3.5" />
                  Код надіслано на{" "}
                  <span className="font-medium text-foreground">{data?.phone}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tg-code" className="text-xs">
                    Код з Telegram (5 цифр)
                  </Label>
                  <Input
                    id="tg-code"
                    inputMode="numeric"
                    placeholder="12345"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    disabled={signInM.isPending}
                  />
                </div>
                {needsPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="tg-pass" className="flex items-center gap-1.5 text-xs">
                      <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                      Пароль 2FA (хмарний захист)
                    </Label>
                    <Input
                      id="tg-pass"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={signInM.isPending}
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => signInM.mutate()}
                    disabled={signInM.isPending || code.length < 4 || (needsPassword && !password)}
                  >
                    {signInM.isPending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    )}
                    Увійти
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => logoutM.mutate()}
                    disabled={logoutM.isPending}
                  >
                    Скасувати
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Сесія зберігається зашифровано на сервері (AES-GCM). Ви можете завершити її будь-якої
              миті — агенти негайно зупинять виконання.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
