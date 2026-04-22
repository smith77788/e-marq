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

export function BalanceCard({
  tenantId,
  tenantSlug,
}: {
  tenantId: string;
  tenantSlug: string;
}) {
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
        .select(
          "id, kind, direction, amount, balance_after, reason, reference_kind, created_at",
        )
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
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
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
          <DialogDescription>
            Оберіть кількість AI-кредитів і спосіб оплати.
          </DialogDescription>
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
                onChange={(e) =>
                  setCredits(Math.max(100, Number(e.target.value) || 0))
                }
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
                <CreditCard className="h-3.5 w-3.5" /> Онлайн
              </TabsTrigger>
            </TabsList>

            <TabsContent value="bank" className="mt-3 space-y-2">
              <div className="rounded-md border border-border bg-card p-3 text-xs">
                <BankRow label="Отримувач" value={BANK_DETAILS.beneficiary} />
                <BankRow label="ЄДРПОУ" value={BANK_DETAILS.edrpou} mono />
                <BankRow label="IBAN" value={BANK_DETAILS.iban} mono />
                <BankRow
                  label="Призначення"
                  value={BANK_DETAILS.purpose(tenantSlug, credits)}
                />
                <BankRow label="Сума" value={`${uah} ₴`} mono />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Після зарахування коштів на наш рахунок ми вручну активуємо ваші кредити
                протягом 1 робочого дня. Ви отримаєте лист на e-mail.
              </p>
            </TabsContent>

            <TabsContent value="manual" className="mt-3 space-y-3">
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>
                    Доступно лише адміністраторам бренду. Зараховує кредити одразу
                    без оплати — використовуйте, якщо у вас з MARQ окрема домовленість
                    (інвойс, бартер, грантовий кредит).
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

            <TabsContent value="online" className="mt-3">
              <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-foreground">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                  <span>
                    Онлайн-оплата картою (LiqPay, WayForPay, Monobank Pay) для тарифу
                    зʼявиться у наступному оновленні. Зараз доступний{" "}
                    <strong>банківський переказ</strong> або <strong>кредит-нота</strong>{" "}
                    від адміністратора.
                  </span>
                </p>
              </div>
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
                Працює лише для власників/адміністраторів бренду. Для звичайної оплати
                використайте банківський переказ.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BankRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`truncate text-foreground ${mono ? "font-mono" : ""}`}
          title={value}
        >
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
