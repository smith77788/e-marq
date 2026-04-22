/**
 * Блок підписки на повідомлення про повернення товару в наявність.
 * Показується, коли активний варіант (або сам товар, якщо без варіантів) має stock=0.
 *
 * Викликає public RPC `subscribe_restock_notification` — анонімний доступ дозволено.
 */
import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  tenantId: string;
  productId: string;
  variantId: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Введіть коректний email",
  product_not_found: "Товар не знайдено",
  variant_not_found: "Варіант не знайдено",
  product_in_stock: "Цей товар уже в наявності — можна одразу замовити",
  variant_in_stock: "Цей варіант уже в наявності — можна одразу замовити",
};

export function RestockSubscribe({ tenantId, productId, variantId }: Props) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("subscribe_restock_notification", {
        _tenant_id: tenantId,
        _product_id: productId,
        // RPC сигнатура очікує UUID; types.ts звужує до string, тому передаємо undefined-as-null trick.
        _variant_id: (variantId ?? null) as unknown as string,
        _email: email.trim(),
      });
      if (error) {
        const code = error.message?.trim();
        toast.error(ERROR_MESSAGES[code] ?? "Не вдалося оформити підписку");
        return;
      }
      const already = (data as { already_subscribed?: boolean } | null)?.already_subscribed;
      toast.success(
        already
          ? "Ви вже у списку — повідомимо одразу, як товар знову з'явиться"
          : "Готово! Надішлемо лист, коли товар повернеться",
      );
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Помилка мережі";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">Підписку оформлено</p>
          <p className="text-muted-foreground">
            Ми надішлемо лист на <span className="font-medium text-foreground">{email}</span>, як
            тільки товар знову з'явиться в наявності.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Повідомити, коли з'явиться</p>
          <p className="text-xs text-muted-foreground">
            Залиште email — напишемо одразу, як поповнимо запас.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="flex-1"
        />
        <Button type="submit" disabled={submitting || !email.trim()} className="sm:w-auto">
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Надсилаємо…
            </>
          ) : (
            "Підписатися"
          )}
        </Button>
      </div>
    </form>
  );
}
