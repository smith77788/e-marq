/**
 * EmailDomainCard — налаштування власного домену відправника (Resend).
 *
 * Розміщується в /brand/integrations поряд з іншими інтеграціями.
 *
 * Логіка:
 *  - GET /api/email/domain-status → показати поточний стан і DNS-записи,
 *  - POST /api/email/domain-setup → створити/прив'язати домен,
 *  - POST /api/email/domain-verify → перевірити SPF/DKIM/DMARC.
 *
 * UX:
 *  - Якщо нічого не налаштовано — форма "Підключити домен".
 *  - Якщо є domain_id — таблиця SPF/DKIM/DMARC + кнопка "Перевірити" + статус-бейдж.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Clock, Copy, Mail, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

type DomainRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  status?: string;
};

type DomainStatus = {
  configured: boolean;
  domain: string | null;
  from_email: string | null;
  from_name: string | null;
  reply_to: string | null;
  resend_domain_id: string | null;
  resend_status: string | null;
  records: DomainRecord[] | null;
  error?: string;
};

async function authedFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Сесія не знайдена");
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

function statusBadge(status: string | null) {
  if (status === "verified") {
    return (
      <Badge className="border-success/40 bg-success/10 text-success">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Верифіковано
      </Badge>
    );
  }
  if (status === "pending" || status === "not_started") {
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        <Clock className="mr-1 h-3 w-3" />
        Очікує верифікації
      </Badge>
    );
  }
  if (status === "failed" || status === "temporary_failure") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Помилка перевірки
      </Badge>
    );
  }
  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Не налаштовано
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

export function EmailDomainCard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  const statusQuery = useQuery({
    queryKey: ["email-domain-status", tenantId],
    queryFn: async (): Promise<DomainStatus> => {
      const r = await authedFetch(
        `/api/email/domain-status?tenant=${encodeURIComponent(tenantId)}`,
      );
      const j = (await r.json()) as DomainStatus & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/email/domain-setup", {
        method: "POST",
        body: JSON.stringify({
          tenantId,
          domain: domain.trim(),
          from_email: fromEmail.trim(),
          from_name: fromName.trim() || undefined,
          reply_to: replyTo.trim() || undefined,
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: () => {
      toast.success("Домен додано", {
        description: "Додайте DNS-записи з таблиці нижче і натисніть «Перевірити».",
      });
      setDomain("");
      setFromEmail("");
      setFromName("");
      setReplyTo("");
      qc.invalidateQueries({ queryKey: ["email-domain-status", tenantId] });
    },
    onError: (e: Error) => toast.error("Не вдалось додати домен", { description: e.message }),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/email/domain-verify", {
        method: "POST",
        body: JSON.stringify({ tenantId }),
      });
      const j = (await r.json()) as { status?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (data) => {
      if (data.status === "verified") {
        toast.success("Домен верифіковано! Тепер листи йдуть з вашого домену.");
      } else {
        toast.info(`Статус: ${data.status ?? "очікує"}`, {
          description: "Перевірка може зайняти до 72 годин після додавання DNS-записів.",
        });
      }
      qc.invalidateQueries({ queryKey: ["email-domain-status", tenantId] });
    },
    onError: (e: Error) => toast.error("Перевірка не вдалась", { description: e.message }),
  });

  const copyValue = (v: string) => {
    navigator.clipboard.writeText(v).then(
      () => toast.success("Скопійовано"),
      () => toast.error("Не вдалося скопіювати — скопіюйте вручну"),
    );
  };

  const status = statusQuery.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Власний домен для листів
            </CardTitle>
            <CardDescription className="text-xs">
              Налаштуйте відправлення з домену вашого магазину (наприклад,{" "}
              <code className="font-mono">no-reply@your-brand.com</code>). Без цього листи приходять
              з <code className="font-mono">onboarding@resend.dev</code>.
            </CardDescription>
          </div>
          {status && statusBadge(status.resend_status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : statusQuery.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {statusQuery.error instanceof Error ? statusQuery.error.message : "Помилка"}
          </div>
        ) : status?.resend_domain_id ? (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-xs text-muted-foreground">Домен</span>
                <div className="font-mono">{status.domain}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">From</span>
                <div className="font-mono">
                  {status.from_name ? `${status.from_name} ` : ""}&lt;{status.from_email}&gt;
                </div>
              </div>
              {status.reply_to && (
                <div>
                  <span className="text-xs text-muted-foreground">Reply-To</span>
                  <div className="font-mono">{status.reply_to}</div>
                </div>
              )}
            </div>

            {status.error && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{status.error}</span>
              </div>
            )}

            {status.records && status.records.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    DNS-записи
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    Додайте у DNS вашого домену, потім натисніть «Перевірити»
                  </span>
                </div>
                <div className="space-y-2">
                  {status.records.map((rec, idx) => (
                    <div
                      key={`${rec.type}-${rec.name}-${idx}`}
                      className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {rec.type}
                        </Badge>
                        {rec.status && (
                          <span
                            className={
                              rec.status === "verified"
                                ? "text-success text-[10px]"
                                : "text-muted-foreground text-[10px]"
                            }
                          >
                            {rec.status === "verified" ? "✓ Підтверджено" : `⌛ ${rec.status}`}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-[80px_1fr_auto] items-start gap-2">
                        <span className="text-muted-foreground pt-1">Name</span>
                        <span className="font-mono break-all">{rec.name}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => copyValue(rec.name)}
                          aria-label="Копіювати DNS-ім'я"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-[80px_1fr_auto] items-start gap-2">
                        <span className="text-muted-foreground pt-1">Value</span>
                        <span className="font-mono break-all">{rec.value}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => copyValue(rec.value)}
                          aria-label="Копіювати DNS-значення"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </div>
                      {rec.ttl && <div className="text-muted-foreground">TTL: {rec.ttl}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              size="sm"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${verifyMutation.isPending ? "animate-spin" : ""}`}
              />
              {verifyMutation.isPending ? "Перевіряю..." : "Перевірити"}
            </Button>
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setupMutation.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="d-domain">Домен</Label>
                <Input
                  id="d-domain"
                  placeholder="your-brand.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required
                  pattern="^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-from-email">From email</Label>
                <Input
                  id="d-from-email"
                  type="email"
                  placeholder={domain ? `no-reply@${domain}` : "no-reply@your-brand.com"}
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-from-name">Імʼя відправника</Label>
                <Input
                  id="d-from-name"
                  placeholder="Назва вашого бренду"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-reply-to">Reply-To (необовʼязково)</Label>
                <Input
                  id="d-reply-to"
                  type="email"
                  placeholder="hello@your-brand.com"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" disabled={setupMutation.isPending}>
              {setupMutation.isPending ? "Додаю..." : "Підключити домен"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Після додавання отримаєте SPF / DKIM / DMARC записи для DNS вашого провайдера. Поки не
              верифіковано — листи йдуть з резервної адреси.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
