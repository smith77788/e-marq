/**
 * EmailCampaignsCard — створення і відправка email-розсилок по сегментах.
 *
 * Розміщується в /brand/promotions поряд з промокодами.
 *
 * Можливості:
 *  - Сегменти: "Усі підписники", "Активні (90 днів)", "VIP", "Сплячі (>90 днів)"
 *  - Тестова відправка на власну адресу.
 *  - Підрахунок одержувачів і suppression-списку.
 *  - Простий HTML-редактор (textarea) — для брендів які знають HTML.
 *  - Журнал останніх 10 кампаній з лічильниками sent/opened/clicked.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Eye, Megaphone, Send, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type Segment = "all" | "active" | "vip" | "lapsed";

const SEGMENT_LABELS: Record<Segment, string> = {
  all: "Усі підписники",
  active: "Активні (замовлення за 90 днів)",
  vip: "VIP (≥ 5000 ₴ витрат)",
  lapsed: "Сплячі (>90 днів)",
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  segment: string | null;
  status: string;
  recipients_count: number;
  opens_count: number;
  clicks_count: number;
  sent_at: string | null;
  created_at: string;
};

type SegmentCount = { segment: Segment; count: number };

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

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="uk"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;padding:28px;">
<tr><td>
<h1 style="margin:0 0 12px;font-size:22px;">Привіт!</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">
У нас новина для вас. Замініть цей текст на ваш контент.
</p>
<a href="https://example.com" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Дивитись</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

export function EmailCampaignsCard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [testEmail, setTestEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Segment counts via direct supabase queries (cheap — uses count: 'exact')
  const segmentCountsQuery = useQuery({
    queryKey: ["email-segment-counts", tenantId],
    queryFn: async (): Promise<SegmentCount[]> => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();

      const [allRes, activeRes, vipRes, lapsedRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("consent_marketing", true)
          .not("email", "is", null),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("consent_marketing", true)
          .not("email", "is", null)
          .gt("total_orders", 0)
          .gte("last_order_at", ninetyDaysAgo),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("consent_marketing", true)
          .not("email", "is", null)
          .gte("total_spent_cents", 500_000),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("consent_marketing", true)
          .not("email", "is", null)
          .gt("total_orders", 0)
          .lt("last_order_at", ninetyDaysAgo),
      ]);

      return [
        { segment: "all", count: allRes.count ?? 0 },
        { segment: "active", count: activeRes.count ?? 0 },
        { segment: "vip", count: vipRes.count ?? 0 },
        { segment: "lapsed", count: lapsedRes.count ?? 0 },
      ];
    },
  });

  const campaignsQuery = useQuery({
    queryKey: ["email-campaigns", tenantId],
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await supabase
        .from("email_campaigns")
        .select(
          "id, name, subject, segment, status, recipients_count, opens_count, clicks_count, sent_at, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });

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
        toast.success("Тестовий лист надіслано", {
          description: `Перевірте поштову скриньку ${testEmail}`,
        });
      } else {
        toast.success("Кампанію відправлено", {
          description: `Надіслано: ${data.sent} / ${data.eligible}`,
        });
        setName("");
        setSubject("");
        setHtml(DEFAULT_HTML);
        setConfirmOpen(false);
        qc.invalidateQueries({ queryKey: ["email-campaigns", tenantId] });
        qc.invalidateQueries({ queryKey: ["email-segment-counts", tenantId] });
      }
    },
    onError: (e: Error) => toast.error("Помилка відправки", { description: e.message }),
  });

  const segmentCount = useMemo(() => {
    if (!segmentCountsQuery.data) return null;
    return segmentCountsQuery.data.find((s) => s.segment === segment)?.count ?? 0;
  }, [segment, segmentCountsQuery.data]);

  const canSubmit =
    name.trim().length > 0 && subject.trim().length > 0 && html.trim().length > 50;
  const canTest =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail) &&
    subject.trim().length > 0 &&
    html.trim().length > 50;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              Email-розсилки
            </CardTitle>
            <CardDescription className="text-xs">
              Створіть кампанію по сегменту клієнтів. Підписані з consent_marketing=true; suppressed (bounce, complaint, unsubscribe) — пропускаються автоматично.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Segment counts */}
        {segmentCountsQuery.data && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {segmentCountsQuery.data.map((s) => (
              <button
                key={s.segment}
                type="button"
                onClick={() => setSegment(s.segment)}
                className={`rounded-md border p-2 text-left transition ${
                  segment === s.segment
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-border"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {SEGMENT_LABELS[s.segment].split(" (")[0]}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{s.count}</div>
              </button>
            ))}
          </div>
        )}

        {/* Form */}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Назва (внутрішня)</Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Літня розпродажа 2026"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-subject">Тема листа</Label>
              <Input
                id="c-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="🌞 -30% на літню колекцію — лише 3 дні"
                maxLength={150}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Сегмент одержувачів</Label>
            <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SEGMENT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="c-html">HTML листа</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                className="h-7 text-xs"
              >
                <Eye className="mr-1 h-3 w-3" />
                Перегляд
              </Button>
            </div>
            <Textarea
              id="c-html"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              className="min-h-[180px] font-mono text-xs"
              placeholder="<html>..."
            />
            <p className="text-xs text-muted-foreground">
              Підтримується <code className="font-mono">{`{{unsubscribe_url}}`}</code> — буде підставлено per-recipient. Якщо плейсхолдера немає, footer додасться автоматично.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="c-test">Тестова відправка</Label>
              <Input
                id="c-test"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                disabled={!canTest || sendMutation.isPending}
                onClick={() => sendMutation.mutate("test")}
              >
                <TestTube2 className="mr-1.5 h-3.5 w-3.5" />
                Надіслати тест
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <div className="text-xs text-muted-foreground">
              {segmentCount !== null && (
                <span>
                  Цільова аудиторія: <strong className="text-foreground">{segmentCount}</strong> одержувачів
                </span>
              )}
            </div>
            <Button
              disabled={!canSubmit || segmentCount === 0 || sendMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Відправити кампанію
            </Button>
          </div>
        </div>

        {/* Recent campaigns */}
        {campaignsQuery.data && campaignsQuery.data.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Останні кампанії
            </h4>
            <div className="space-y-1.5">
              {campaignsQuery.data.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/40 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{c.name}</div>
                    <div className="truncate text-muted-foreground">{c.subject}</div>
                  </div>
                  <Badge
                    variant={
                      c.status === "sent"
                        ? "default"
                        : c.status === "failed"
                          ? "destructive"
                          : "outline"
                    }
                    className="text-[10px]"
                  >
                    {c.status}
                  </Badge>
                  <div className="hidden gap-3 text-muted-foreground tabular-nums sm:flex">
                    <span>📬 {c.recipients_count}</span>
                    <span>👁 {c.opens_count}</span>
                    <span>🖱 {c.clicks_count}</span>
                  </div>
                  <span className="hidden text-muted-foreground sm:inline">
                    {format(new Date(c.sent_at ?? c.created_at), "dd.MM HH:mm")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Перегляд листа</DialogTitle>
            <DialogDescription>
              Тема: <span className="font-medium">{subject || "(без теми)"}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-white">
            <iframe
              title="email-preview"
              srcDoc={html}
              className="h-[60vh] w-full"
              sandbox=""
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Підтвердити відправку</DialogTitle>
            <DialogDescription>
              Кампанія «<strong>{name}</strong>» буде надіслана на <strong>{segmentCount}</strong> одержувачів сегменту «{SEGMENT_LABELS[segment]}». Цю дію не можна скасувати.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sendMutation.isPending}>
              Скасувати
            </Button>
            <Button onClick={() => sendMutation.mutate("real")} disabled={sendMutation.isPending}>
              {sendMutation.isPending ? "Відправляю..." : "Так, відправити"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
