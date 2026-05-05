/**
 * ProductEconomicsPanel
 *
 * UI для введення COGS / target margin / min margin per product.
 * Активує margin-aware decisioning guardrail у auto_approve_eligible_decisions:
 *   discount_dead_stock + price_adjust скіпаються якщо post-discount margin < min_margin_pct.
 *
 * Без введення COGS вся причинно-економічна гілка лишається теоретичною —
 * саме тому цей панель і існує.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  tenantId: string;
  productId: string;
  priceCents: number;
  currency: string;
};

type EconomicsRow = {
  cogs_cents: number | null;
  target_margin_pct: number | null;
  min_margin_pct: number | null;
  notes: string | null;
};

function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function ProductEconomicsPanel({ tenantId, productId, priceCents, currency }: Props) {
  const qc = useQueryClient();
  const [cogs, setCogs] = useState("");
  const [targetMargin, setTargetMargin] = useState("30");
  const [minMargin, setMinMargin] = useState("10");
  const [notes, setNotes] = useState("");

  const ecoQuery = useQuery({
    queryKey: ["product-economics", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_economics")
        .select("cogs_cents, target_margin_pct, min_margin_pct, notes")
        .eq("tenant_id", tenantId)
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw error;
      return (data as EconomicsRow | null) ?? null;
    },
  });

  useEffect(() => {
    if (ecoQuery.data) {
      setCogs(centsToDollars(ecoQuery.data.cogs_cents));
      setTargetMargin(String(ecoQuery.data.target_margin_pct ?? 30));
      setMinMargin(String(ecoQuery.data.min_margin_pct ?? 10));
      setNotes(ecoQuery.data.notes ?? "");
    }
  }, [ecoQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const cogsCents = cogs ? Math.round(parseFloat(cogs) * 100) : null;
      const tgt = targetMargin ? parseFloat(targetMargin) : 30;
      const mn = minMargin ? parseFloat(minMargin) : 10;
      if (cogsCents != null && (Number.isNaN(cogsCents) || cogsCents < 0)) {
        throw new Error("Некоректне значення COGS");
      }
      if (mn < 0 || mn > 100 || tgt < 0 || tgt > 100) {
        throw new Error("Margin має бути 0–100%");
      }
      const { error } = await supabase
        .from("product_economics")
        .upsert(
          [{
            tenant_id: tenantId,
            product_id: productId,
            cogs_cents: cogsCents,
            target_margin_pct: tgt,
            min_margin_pct: mn,
            notes: notes || null,
          }],
          { onConflict: "tenant_id,product_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Економіку збережено");
      qc.invalidateQueries({ queryKey: ["product-economics", productId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (ecoQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  // Live preview: current margin at price (no discount)
  const cogsCentsNum = cogs ? Math.round(parseFloat(cogs) * 100) : null;
  const currentMarginPct =
    cogsCentsNum != null && priceCents > 0
      ? ((priceCents - cogsCentsNum) / priceCents) * 100
      : null;

  // Max safe discount % that still keeps min_margin_pct
  const minMarginNum = parseFloat(minMargin) || 0;
  let maxDiscountPct: number | null = null;
  if (cogsCentsNum != null && priceCents > 0 && minMarginNum < 100) {
    // (price*(1-d) - cogs) / (price*(1-d)) >= min/100
    // => price*(1-d)*(1 - min/100) >= cogs
    // => 1-d >= cogs / (price*(1-min/100))
    const denom = priceCents * (1 - minMarginNum / 100);
    if (denom > 0) {
      const ratio = cogsCentsNum / denom;
      maxDiscountPct = Math.max(0, Math.min(100, (1 - ratio) * 100));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Економіка товару
        </CardTitle>
        <CardDescription>
          COGS і цільова маржа. Без цих даних AI-агент не наважиться запускати знижки чи
          змінювати ціну автоматично — рішення піде в Inbox на ручне підтвердження.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="e-cogs">Собівартість (COGS), {currency}</Label>
            <Input
              id="e-cogs"
              type="number"
              step="0.01"
              min="0"
              value={cogs}
              onChange={(e) => setCogs(e.target.value)}
              placeholder="—"
            />
            <p className="text-[10px] text-muted-foreground">
              Поточна ціна: {centsToDollars(priceCents)} {currency}
              {currentMarginPct != null && (
                <>
                  {" · "}
                  Маржа зараз:{" "}
                  <span
                    className={
                      currentMarginPct < minMarginNum
                        ? "text-destructive font-semibold"
                        : "text-foreground font-semibold"
                    }
                  >
                    {currentMarginPct.toFixed(1)}%
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-target">Цільова маржа, %</Label>
            <Input
              id="e-target"
              type="number"
              step="1"
              min="0"
              max="100"
              value={targetMargin}
              onChange={(e) => setTargetMargin(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">До чого прагнемо</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="e-min">Мінімальна маржа, %</Label>
          <Input
            id="e-min"
            type="number"
            step="1"
            min="0"
            max="100"
            value={minMargin}
            onChange={(e) => setMinMargin(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            Auto-approval не пропустить знижку, якщо маржа після неї впаде нижче.
            {maxDiscountPct != null && (
              <>
                {" "}
                Макс. безпечна знижка:{" "}
                <span className="font-semibold text-foreground">
                  {maxDiscountPct.toFixed(1)}%
                </span>
              </>
            )}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="e-notes">Нотатки</Label>
          <Textarea
            id="e-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Постачальник, доставка, упаковка…"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {save.isPending ? "Зберігаю…" : "Зберегти економіку"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
