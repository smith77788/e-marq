/**
 * Баланс бренду + поповнення + журнал операцій.
 *
 * Поповнення:
 *  - Manual (адмін-власник тенанта одразу зараховує суму через RPC
 *    owner_topup_ai_credits — це працює як «кредит-нота» для AI-кредитів).
 *  - Bank transfer (показуємо реквізити, користувач переказує гроші,
 *    адміністратор підтверджує вручну).
 *  - Online (LiqPay/WayForPay/Monobank) — поки що недоступно для тарифу,
 *    повідомляємо чесно.
 *
 * Все в одному компоненті, без зайвих залежностей.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  CreditCard,
  History,
  Info,
  Loader2,
  Phone,
  Plus,
  Send,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

type Balance = {
  tenant_id: string;
  ai_credits_balance: number;
  ai_credits_granted_this_period: number;
  ai_credits_consumed_this_period: number;
  money_balance_cents: number;
  currency: string;
  updated_at: string;
};

type LedgerRow = {
  id: string;
  kind: string;
  direction: string;
  amount: number;
  balance_after: number;
  reason: string;
  reference_kind: string | null;
  created_at: string;
};

const TOPUP_PRESETS = [
  { credits: 1000, uah: 100 },
  { credits: 5000, uah: 450 },
  { credits: 15000, uah: 1200 },
  { credits: 50000, uah: 3500 },
];

// Реквізити для банківського переказу — захардкожені для першої ітерації;
// у наступному спрінті винесемо в settings адмінки.
const BANK_DETAILS = {
  beneficiary: "ТОВ «MARQ Cloud»",
  iban: "UA21 3052 9900 0002 6005 0123 4567 8",
  edrpou: "44123456",
  purpose: (slug: string, credits: number) =>
    `Поповнення тарифного балансу MARQ, бренд ${slug}, ${credits} кредитів`,
};

function formatUah(cents: number) {
  return `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`;
}

function copy(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Скопійовано: ${label}`),
    () => toast.error("Не вдалося скопіювати"),
  );
}

export function BalanceCard({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const qc = useQueryClient();

  const balanceQuery = useQuery({
    queryKey: ["tenant-balance", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_balances")
        .select(
          "tenant_id, ai_credits_balance, ai_credits_granted_this_period, ai_credits_consumed_this_period, money_balance_cents, currency, updated_at",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Balance | null;
    },
  });

  const ledgerQuery = useQuery({
    queryKey: ["balance-ledger", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("balance_ledger")
        .select("id, kind, direction, amount, balance_after, reason, reference_kind, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });

  const balance = balanceQuery.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-success" />
            Баланс і поповнення
          </CardTitle>
          <TopupDialog
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["tenant-balance", tenantId] });
              qc.invalidateQueries({ queryKey: ["balance-ledger", tenantId] });
            }}
          />
        </div>
        <CardDescription>
          AI-кредити споживаються агентами. Баланс грошей — резерв для майбутніх онлайн-оплат.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {balanceQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Завантажую баланс…</p>
        ) : balance ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              icon={<Sparkles className="h-4 w-4 text-accent" />}
              label="AI-кредити"
              value={balance.ai_credits_balance.toLocaleString("uk-UA")}
              hint={`Спожито за період: ${balance.ai_credits_consumed_this_period.toLocaleString("uk-UA")}`}
            />
            <Stat
              icon={<Coins className="h-4 w-4 text-warning" />}
              label="Нараховано за період"
              value={balance.ai_credits_granted_this_period.toLocaleString("uk-UA")}
              hint="Скидається при перемиканні тарифу"
            />
            <Stat
              icon={<Banknote className="h-4 w-4 text-success" />}
              label="Грошовий резерв"
              value={formatUah(balance.money_balance_cents)}
              hint="Для майбутніх онлайн-платежів"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Баланс іще не ініціалізовано — він зʼявиться після першого нарахування за тарифом.
          </p>
        )}

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Історія операцій (останні 20)
          </div>
          {ledgerQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Завантажую…</p>
          ) : ledgerQuery.data && ledgerQuery.data.length > 0 ? (
            <div className="divide-y divide-border rounded-md border border-border">
              {ledgerQuery.data.map((r) => {
                const isCredit = r.direction === "credit";
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isCredit ? (
                        <ArrowDownCircle className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <ArrowUpCircle className="h-4 w-4 shrink-0 text-warning" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-foreground">{r.reason}</p>
                        <p className="text-muted-foreground">
                          {new Date(r.created_at).toLocaleString("uk-UA")} · {r.kind}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={
                          isCredit
                            ? "font-mono font-semibold text-success"
                            : "font-mono font-semibold text-warning"
                        }
                      >
                        {isCredit ? "+" : "−"}
                        {r.amount.toLocaleString("uk-UA")}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        бал.: {r.balance_after.toLocaleString("uk-UA")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Операцій ще не було.</p>
          )}
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Send className="h-3.5 w-3.5" /> Заявки на онлайн-оплату
          </div>
          <TopupRequestsList tenantId={tenantId} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TopupDialog({
  tenantId,
  tenantSlug,
  onSuccess,
}: {
  tenantId: string;
  tenantSlug: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState<number>(5000);
  const [reason, setReason] = useState("");

  const uah = Math.max(1, Math.round((credits / 1000) * 90)); // ~90 ₴ за 1000 кредитів

  const topupMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("owner_topup_ai_credits", {
        _tenant_id: tenantId,
        _amount: credits,
        _reason: reason.trim() || `Manual top-up ${credits} credits`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Зараховано ${credits.toLocaleString("uk-UA")} AI-кредитів`);
      setOpen(false);
      setReason("");
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Поповнити
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Поповнення балансу</DialogTitle>
          <DialogDescription>Оберіть кількість AI-кредитів і спосіб оплати.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Кількість AI-кредитів</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TOPUP_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.credits}
                  onClick={() => setCredits(p.credits)}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    credits === p.credits
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  <p className="font-mono text-sm font-semibold text-foreground">
                    {p.credits.toLocaleString("uk-UA")}
                  </p>
                  <p>≈ {p.uah} ₴</p>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={100}
                step={100}
                value={credits}
                onChange={(e) => setCredits(Math.max(100, Number(e.target.value) || 0))}
                className="font-mono"
              />
              <Badge variant="outline" className="whitespace-nowrap">
                ≈ {uah.toLocaleString("uk-UA")} ₴
              </Badge>
            </div>
          </div>

          <Tabs defaultValue="bank">
            <TabsList className="w-full">
              <TabsTrigger value="bank" className="flex-1 gap-1.5">
                <Banknote className="h-3.5 w-3.5" /> Банківський переказ
              </TabsTrigger>
              <TabsTrigger value="manual" className="flex-1 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Кредит-нота (адмін)
              </TabsTrigger>
              <TabsTrigger value="online" className="flex-1 gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> Через менеджера
              </TabsTrigger>
            </TabsList>

            <TabsContent value="bank" className="mt-3 space-y-2">
              <div className="rounded-md border border-border bg-card p-3 text-xs">
                <BankRow label="Отримувач" value={BANK_DETAILS.beneficiary} />
                <BankRow label="ЄДРПОУ" value={BANK_DETAILS.edrpou} mono />
                <BankRow label="IBAN" value={BANK_DETAILS.iban} mono />
                <BankRow label="Призначення" value={BANK_DETAILS.purpose(tenantSlug, credits)} />
                <BankRow label="Сума" value={`${uah} ₴`} mono />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Після зарахування коштів на наш рахунок ми вручну активуємо ваші кредити протягом 1
                робочого дня. Ви отримаєте лист на e-mail.
              </p>
            </TabsContent>

            <TabsContent value="manual" className="mt-3 space-y-3">
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>
                    Доступно лише адміністраторам бренду. Зараховує кредити одразу без оплати —
                    використовуйте, якщо у вас з MARQ окрема домовленість (інвойс, бартер, грантовий
                    кредит).
                  </span>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="topup-reason">Причина (для журналу)</Label>
                <Input
                  id="topup-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Напр., оплачений інвойс №2024-12"
                />
              </div>
            </TabsContent>

            <TabsContent value="online" className="mt-3 space-y-3">
              <ManagerRequestPanel
                tenantId={tenantId}
                credits={credits}
                amountCents={uah * 100}
                onCreated={() => {
                  setOpen(false);
                  onSuccess();
                }}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Закрити
          </Button>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => topupMut.mutate()}
                  disabled={topupMut.isPending || credits < 100}
                >
                  {topupMut.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-4 w-4" />
                  )}
                  Зарахувати {credits.toLocaleString("uk-UA")} (адмін)
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Працює лише для власників/адміністраторів бренду. Для звичайної оплати використайте
                банківський переказ.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BankRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate text-foreground ${mono ? "font-mono" : ""}`} title={value}>
          {value}
        </span>
        <button
          type="button"
          onClick={() => copy(value, label)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Копіювати ${label}`}
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Заявка на онлайн-оплату через менеджера
// ────────────────────────────────────────────────────────────────────────────

type ManagerRequestPanelProps = {
  tenantId: string;
  credits: number;
  amountCents: number;
  onCreated: () => void;
};

function ManagerRequestPanel({
  tenantId,
  credits,
  amountCents,
  onCreated,
}: ManagerRequestPanelProps) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<"card" | "bank" | "crypto" | "other">("card");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (!contact.trim()) throw new Error("Вкажіть контакт для звʼязку");
      const { error } = await supabase.from("topup_requests").insert({
        tenant_id: tenantId,
        credits,
        amount_cents: amountCents,
        currency: "UAH",
        payment_method: method,
        contact: contact.trim(),
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Заявку прийнято — менеджер звʼяжеться найближчим часом");
      qc.invalidateQueries({ queryKey: ["topup-requests", tenantId] });
      setContact("");
      setNote("");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-foreground">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <span>
            Залиште заявку — менеджер MARQ перетелефонує протягом 1 робочого дня, погодить спосіб
            оплати (карта, СБП, крипто, інвойс) і одразу зарахує кредити після надходження коштів.
          </span>
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Бажаний спосіб оплати</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { id: "card", label: "Карта" },
              { id: "bank", label: "Інвойс" },
              { id: "crypto", label: "Крипто" },
              { id: "other", label: "Інше" },
            ] as const
          ).map((opt) => (
            <button
              type="button"
              key={opt.id}
              onClick={() => setMethod(opt.id)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                method === opt.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="topup-contact" className="text-xs">
          Контакт для звʼязку *
        </Label>
        <Input
          id="topup-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Telegram, телефон або e-mail"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="topup-note" className="text-xs">
          Коментар (необовʼязково)
        </Label>
        <Textarea
          id="topup-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Напр., потрібен інвойс на ТОВ, оплата до 25-го"
          rows={3}
        />
      </div>

      <Button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || credits < 100}
        className="w-full"
      >
        {mut.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        Надіслати заявку на {credits.toLocaleString("uk-UA")} кредитів
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Журнал заявок (показуємо у BalanceCard окремою секцією)
// ────────────────────────────────────────────────────────────────────────────

type TopupRequest = {
  id: string;
  credits: number;
  amount_cents: number;
  currency: string;
  payment_method: string;
  contact: string | null;
  status: "new" | "in_review" | "paid" | "cancelled";
  manager_note: string | null;
  created_at: string;
};

const STATUS_META: Record<
  TopupRequest["status"],
  { label: string; tone: string; Icon: typeof Clock }
> = {
  new: {
    label: "Нова",
    tone: "border-info/40 text-info",
    Icon: Clock,
  },
  in_review: {
    label: "У роботі",
    tone: "border-warning/40 text-warning",
    Icon: Phone,
  },
  paid: {
    label: "Оплачено",
    tone: "border-success/40 text-success",
    Icon: CheckCircle2,
  },
  cancelled: {
    label: "Скасовано",
    tone: "border-destructive/40 text-destructive",
    Icon: XCircle,
  },
};

export function TopupRequestsList({ tenantId }: { tenantId: string }) {
  const q = useQuery({
    queryKey: ["topup-requests", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topup_requests")
        .select(
          "id, credits, amount_cents, currency, payment_method, contact, status, manager_note, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as TopupRequest[];
    },
  });

  if (q.isLoading) return <p className="text-xs text-muted-foreground">Завантажую заявки…</p>;
  if (!q.data || q.data.length === 0) {
    return <p className="text-xs text-muted-foreground">Поки що немає заявок на онлайн-оплату.</p>;
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {q.data.map((r) => {
        const meta = STATUS_META[r.status];
        return (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="outline" className={meta.tone}>
                <meta.Icon className="mr-1 h-3 w-3" />
                {meta.label}
              </Badge>
              <div className="min-w-0">
                <p className="truncate text-foreground">
                  {r.credits.toLocaleString("uk-UA")} кредитів · {(r.amount_cents / 100).toFixed(0)}{" "}
                  {r.currency}
                </p>
                <p className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("uk-UA")} · {r.payment_method}
                  {r.contact ? ` · ${r.contact}` : ""}
                </p>
                {r.manager_note && (
                  <p className="mt-0.5 text-muted-foreground">💬 {r.manager_note}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
