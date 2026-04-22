/**
 * EmailCampaignWizard — формальний 4-кроковий майстер відправки кампанії.
 *
 * Step 1 · Audience      — обираємо сегмент, бачимо реальну кількість одержувачів
 * Step 2 · Subject       — назва (внутрішня) + тема листа + preheader
 * Step 3 · Content       — HTML листа з шаблонами і live preview iframe
 * Step 4 · Review & Send — підсумок + тестова відправка + кнопка «Запустити»
 *
 * Логіка відправки спирається на той самий `/api/email/campaign-send`, що й
 * EmailCampaignsCard, але з більш керованим UX: користувач не пропускає
 * критичні поля, бо кожен step валідується перед переходом до наступного.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Megaphone,
  Send,
  Sparkles,
  TestTube2,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type Segment = "all" | "active" | "vip" | "lapsed";

const SEGMENT_LABELS: Record<Segment, { title: string; desc: string }> = {
  all: { title: "Усі підписники", desc: "Усі клієнти з consent_marketing = true" },
  active: { title: "Активні", desc: "Зробили замовлення за останні 90 днів" },
  vip: { title: "VIP", desc: "Lifetime витрат ≥ 5 000 ₴" },
  lapsed: { title: "Сплячі", desc: "Не купували понад 90 днів" },
};

const TEMPLATES: Record<string, { name: string; html: string; subject: string }> = {
  promo: {
    name: "Промо · знижка",
    subject: "🎉 Спеціальна пропозиція тільки для вас",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;padding:28px;"><tr><td>
<h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">Тільки сьогодні — −20%</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#334155;">Ми приготували для вас особливу знижку. Промокод діє 24 години.</p>
<div style="background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;margin:0 0 20px;">
  <div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.1em;">Ваш код</div>
  <div style="font-size:28px;font-weight:700;color:#0f172a;font-family:monospace;letter-spacing:0.05em;margin-top:4px;">SPECIAL20</div>
</div>
<a href="https://example.com" style="display:inline-block;background:#0f172a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Використати знижку</a>
</td></tr></table></td></tr></table></body></html>`,
  },
  newsletter: {
    name: "Newsletter",
    subject: "Свіжі новини бренду",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;padding:28px;"><tr><td>
<h1 style="margin:0 0 12px;font-size:22px;">Привіт!</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Розповідаємо що нового у нас цього місяця.</p>
<h2 style="margin:24px 0 8px;font-size:17px;color:#0f172a;">Новинка тижня</h2>
<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#475569;">Опишіть тут одну ключову новинку.</p>
<a href="https://example.com" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Подивитись</a>
</td></tr></table></td></tr></table></body></html>`,
  },
  reengage: {
    name: "Reengage · ми скучили",
    subject: "Скучили — повертайтесь з −15%",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#fff7ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;padding:28px;border:1px solid #fed7aa;"><tr><td>
<h1 style="margin:0 0 12px;font-size:22px;">Давно не бачились 👋</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Маємо для вас невеличку радість — мінус 15% на наступне замовлення.</p>
<a href="https://example.com" style="display:inline-block;background:#ea580c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Повернутись</a>
</td></tr></table></td></tr></table></body></html>`,
  },
};

type Step = 1 | 2 | 3 | 4;

const STEP_META: Record<Step, { title: string; icon: typeof Users }> = {
  1: { title: "Аудиторія", icon: Users },
  2: { title: "Тема", icon: FileText },
  3: { title: "Контент", icon: Megaphone },
  4: { title: "Перевірка та відправка", icon: Send },
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

export function EmailCampaignWizard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [segment, setSegment] = useState<Segment>("all");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [html, setHtml] = useState(TEMPLATES.promo.html);
  const [testEmail, setTestEmail] = useState("");

  const counts = useQuery({
    queryKey: ["wizard-segment-counts", tenantId],
    queryFn: async () => {
      const ago90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const base = () =>
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("consent_marketing", true)
          .not("email", "is", null);
      const [a, ac, vip, lap] = await Promise.all([
        base(),
        base().gt("total_orders", 0).gte("last_order_at", ago90),
        base().gte("total_spent_cents", 500_000),
        base().gt("total_orders", 0).lt("last_order_at", ago90),
      ]);
      return {
        all: a.count ?? 0,
        active: ac.count ?? 0,
        vip: vip.count ?? 0,
        lapsed: lap.count ?? 0,
      } as Record<Segment, number>;
    },
  });

  const segmentCount = counts.data?.[segment] ?? 0;

  const sendMutation = useMutation({
    mutationFn: async (mode: "test" | "real") => {
      const body: Record<string, unknown> = {
        tenantId,
        subject: subject.trim(),
        html,
      };
      if (mode === "test") {
        body.testEmail = testEmail.trim();
        body.name = name.trim() || "Тестова кампанія";
      } else {
        body.name = name.trim();
        body.segment = segment;
      }
      const r = await authedFetch("/api/email/campaign-send", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { error?: string; sent?: number; eligible?: number };
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (data, mode) => {
      if (mode === "test") {
        toast.success("Тест відправлено", {
          description: `Перевірте ${testEmail}`,
        });
        return;
      }
      toast.success("Кампанію надіслано", {
        description: `Доставлено ${data.sent} / ${data.eligible}`,
      });
      qc.invalidateQueries({ queryKey: ["email-campaigns", tenantId] });
      qc.invalidateQueries({ queryKey: ["wizard-segment-counts", tenantId] });
      // reset wizard
      setStep(1);
      setName("");
      setSubject("");
      setPreheader("");
      setHtml(TEMPLATES.promo.html);
    },
    onError: (e: Error) => toast.error("Помилка", { description: e.message }),
  });

  const canProceed: Record<Step, boolean> = useMemo(
    () => ({
      1: segmentCount > 0,
      2: name.trim().length >= 2 && subject.trim().length >= 4,
      3: html.trim().length >= 80,
      4: true,
    }),
    [segmentCount, name, subject, html],
  );

  const previewHtml = useMemo(() => {
    if (!preheader.trim()) return html;
    // Inject preheader as hidden preview text after <body ...>
    return html.replace(
      /<body([^>]*)>/i,
      `<body$1><div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>`,
    );
  }, [html, preheader]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> Майстер кампанії
        </CardTitle>
        <CardDescription>
          Покроковий запуск email-кампанії з валідацією на кожному кроці.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stepper */}
        <ol className="grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as Step[]).map((n) => {
            const meta = STEP_META[n];
            const Icon = meta.icon;
            const done = step > n;
            const active = step === n;
            return (
              <li
                key={n}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border px-2 py-2",
                  active
                    ? "border-primary bg-primary/5 text-foreground"
                    : done
                      ? "border-success/40 bg-success/5 text-foreground"
                      : "border-border/60 bg-card/40 text-muted-foreground",
                )}
              >
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
                  {done ? (
                    <CheckCircle2 className="h-3 w-3 text-success" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  <span>Крок {n}</span>
                </div>
                <p className="text-xs font-medium">{meta.title}</p>
              </li>
            );
          })}
        </ol>

        <Separator />

        {/* Step body */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => {
                const sel = segment === s;
                const c = counts.data?.[s] ?? 0;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSegment(s)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      sel
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-border",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">
                        {SEGMENT_LABELS[s].title}
                      </p>
                      <Badge variant={sel ? "default" : "outline"} className="tabular-nums">
                        {counts.isLoading ? "…" : c}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {SEGMENT_LABELS[s].desc}
                    </p>
                  </button>
                );
              })}
            </div>
            {segmentCount === 0 && !counts.isLoading && (
              <p className="rounded-md bg-warning/10 p-3 text-xs text-warning">
                У цьому сегменті 0 одержувачів — оберіть інший або наповніть базу.
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="w-name">Назва (внутрішня)</Label>
              <Input
                id="w-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Літня розпродажа 2026"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-subject">Тема листа</Label>
              <Input
                id="w-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="🌞 -30% на літню колекцію — лише 3 дні"
                maxLength={150}
              />
              <p className="text-[11px] text-muted-foreground">
                Оптимальна довжина 30–60 символів. Зараз: {subject.length}.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-pre">Preheader (превʼю-рядок)</Label>
              <Input
                id="w-pre"
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                placeholder="Маленький рядок, що показується після теми у поштовому клієнті"
                maxLength={120}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(TEMPLATES).map(([k, tpl]) => (
                <Button
                  key={k}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHtml(tpl.html);
                    if (!subject.trim()) setSubject(tpl.subject);
                  }}
                >
                  {tpl.name}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="w-html">HTML</Label>
                <Textarea
                  id="w-html"
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  className="min-h-[280px] font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Підтримується <code>{`{{unsubscribe_url}}`}</code> — підставиться
                  per-recipient. Якщо плейсхолдера немає, footer додасться автоматично.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" /> Live preview
                </Label>
                <div className="overflow-hidden rounded-md border border-border bg-white">
                  <iframe
                    title="wizard-preview"
                    srcDoc={previewHtml}
                    className="h-[280px] w-full"
                    sandbox=""
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewRow label="Сегмент" value={SEGMENT_LABELS[segment].title} />
              <ReviewRow label="Одержувачів" value={String(segmentCount)} />
              <ReviewRow label="Назва" value={name} />
              <ReviewRow label="Тема" value={subject} />
              {preheader && <ReviewRow label="Preheader" value={preheader} />}
            </div>
            <div className="overflow-hidden rounded-md border border-border bg-white">
              <iframe
                title="wizard-final-preview"
                srcDoc={previewHtml}
                className="h-[260px] w-full"
                sandbox=""
              />
            </div>
            <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/40 p-3">
              <Label htmlFor="w-test" className="text-xs">
                Тестова відправка
              </Label>
              <div className="flex gap-2">
                <Input
                  id="w-test"
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail) || sendMutation.isPending
                  }
                  onClick={() => sendMutation.mutate("test")}
                >
                  <TestTube2 className="mr-1.5 h-3.5 w-3.5" />
                  Тест
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
            disabled={step === 1 || sendMutation.isPending}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Назад
          </Button>
          {step < 4 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => ((s + 1) as Step))}
              disabled={!canProceed[step]}
            >
              Далі <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => sendMutation.mutate("real")}
              disabled={
                segmentCount === 0 ||
                !canProceed[1] ||
                !canProceed[2] ||
                !canProceed[3] ||
                sendMutation.isPending
              }
            >
              {sendMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Запустити кампанію
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}
