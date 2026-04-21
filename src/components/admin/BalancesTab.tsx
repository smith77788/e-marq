/**
 * Super-admin tab for crediting/debiting AI credits & money balance, plus full ledger.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Coins, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMoneyExact } from "@/lib/money";

export function BalancesTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"ai_credits" | "money">("ai_credits");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");

  const balancesQuery = useQuery({
    queryKey: ["tenant-balances", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_balances")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
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
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const adjust = useMutation({
    mutationFn: async () => {
      const num = Math.round(Number(amount));
      if (!Number.isFinite(num) || num <= 0) throw new Error("Введи додатне число");
      const signed = direction === "credit" ? num : -num;
      const { error } = await supabase.rpc("add_balance", {
        _tenant_id: tenantId,
        _kind: kind,
        _amount: signed,
        _reason: reason || (direction === "credit" ? "Ручне нарахування" : "Ручне списання"),
        _reference_kind: "manual_grant",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Баланс оновлено");
      setAmount("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["tenant-balances", tenantId] });
      qc.invalidateQueries({ queryKey: ["balance-ledger", tenantId] });
      qc.invalidateQueries({ queryKey: ["plan-summary", tenantId] });
      qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const b = balancesQuery.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
            <Coins className="h-5 w-5 text-primary" />
            <CardTitle className="text-sm font-medium">AI-кредити</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{(b?.ai_credits_balance ?? 0).toLocaleString("uk-UA")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Нараховано цього періоду: {(b?.ai_credits_granted_this_period ?? 0).toLocaleString("uk-UA")} ·
              Витрачено: {(b?.ai_credits_consumed_this_period ?? 0).toLocaleString("uk-UA")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
            <Wallet className="h-5 w-5 text-success" />
            <CardTitle className="text-sm font-medium">Грошовий баланс</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {formatMoneyExact(b?.money_balance_cents ?? 0)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Для платіжного шлюзу та комісій платформи.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Змінити баланс</CardTitle>
          <CardDescription>Кожна зміна записується в історію з твоїм ID — нічого не загубиться.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Що змінюємо</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "ai_credits" | "money")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai_credits">AI-кредити</SelectItem>
                  <SelectItem value="money">Гроші (копійки)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Напрям</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "credit" | "debit")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Додати (+)</SelectItem>
                  <SelectItem value="debit">Списати (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Скільки</Label>
              <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label>Причина</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Бонус, повернення…" />
            </div>
          </div>
          <Button onClick={() => adjust.mutate()} disabled={adjust.isPending || !amount}>
            {adjust.isPending ? "Зберігаю…" : "Застосувати"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Історія змін</CardTitle>
          <CardDescription>Останні 100 записів. Незмінний журнал — для прозорості.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          {ledgerQuery.data && ledgerQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Коли</TableHead>
                  <TableHead>Що</TableHead>
                  <TableHead>Δ</TableHead>
                  <TableHead>Баланс після</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Джерело</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerQuery.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {new Date(row.created_at).toLocaleString("uk-UA")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.kind === "ai_credits" ? "AI-кредити" : "Гроші"}
                    </TableCell>
                    <TableCell className={cn(
                      "font-mono text-xs",
                      row.direction === "credit" ? "text-success" : "text-destructive",
                    )}>
                      <span className="inline-flex items-center gap-1">
                        {row.direction === "credit"
                          ? <ArrowUpRight className="h-3 w-3" />
                          : <ArrowDownLeft className="h-3 w-3" />}
                        {row.direction === "credit" ? "+" : "−"}{row.amount.toLocaleString("uk-UA")}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.balance_after.toLocaleString("uk-UA")}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs">{row.reason}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{row.reference_kind ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground">Поки що змін немає.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
