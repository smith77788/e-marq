/**
 * Self-service AI-credits top-up for tenant owners/admins.
 * Calls owner_topup_ai_credits RPC (server-side enforces is_tenant_admin + cap).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const PRESETS = [100, 500, 1000, 5000];

export function OwnerTopUpCard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("500");
  const [reason, setReason] = useState("");

  const topup = useMutation({
    mutationFn: async () => {
      const num = Math.round(Number(amount));
      if (!Number.isFinite(num) || num <= 0) throw new Error("Введи додатне число");
      if (num > 100000) throw new Error("За один раз — не більше 100 000 кредитів");
      const { error } = await supabase.rpc("owner_topup_ai_credits", {
        _tenant_id: tenantId,
        _amount: num,
        _reason: reason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Нараховано ${Number(amount).toLocaleString("uk-UA")} AI-кредитів`);
      setReason("");
      qc.invalidateQueries({ queryKey: ["plan-summary", tenantId] });
      qc.invalidateQueries({ queryKey: ["balance-ledger", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Поповнити AI-кредити
        </CardTitle>
        <CardDescription>
          Швидке поповнення для тестів і пікових днів. Кожна транзакція зберігається в журналі.
          Максимум 100 000 кредитів за раз.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-1">
            <Label htmlFor="topup-amount">Кількість</Label>
            <Input
              id="topup-amount"
              type="number"
              min="1"
              max="100000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="topup-reason">Причина (необов'язково)</Label>
            <Input
              id="topup-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Наприклад: запуск кампанії"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant="outline"
              onClick={() => setAmount(String(p))}
            >
              +{p.toLocaleString("uk-UA")}
            </Button>
          ))}
        </div>
        <Button onClick={() => topup.mutate()} disabled={topup.isPending || !amount}>
          {topup.isPending ? "Нараховую…" : "Поповнити"}
        </Button>
      </CardContent>
    </Card>
  );
}
