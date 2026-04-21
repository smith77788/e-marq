/**
 * One-page checkout — cart summary + contacts + payment method + promo code.
 *
 * Server validation (place_storefront_order RPC) recomputes totals — client
 * cannot tamper with prices. Stripe/LiqPay/etc. are wired in Sprint 4.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CreditCard,
  Landmark,
  Loader2,
  Tag,
  Trash2,
  Plus,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { loadStorefrontShell } from "@/lib/storefront/loaders";
import { useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { formatMoneyExact } from "@/lib/money";

type DiscountResult =
  | { valid: true; promo_id: string; name: string; type: string; discount_cents: number }
  | { valid: false; error: string; min_cents?: number };

export const Route = createFileRoute("/s/$slug/checkout")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: () => ({
    meta: [
      { title: "Оформлення замовлення" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка: {error.message}</p>
    </div>
  ),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const cart = useStorefrontCart();

  const { data: shell } = useQuery({
    queryKey: ["storefront-shell", slug],
    queryFn: () => loadStorefrontShell(slug),
    initialData: initial,
    staleTime: 30_000,
  });

  const payments = shell.config.features?.payments ?? {
    manual_enabled: true,
  };

  const manualEnabled = payments.manual_enabled !== false;
  const stripeEnabled = payments.stripe_enabled === true;
  const noMethods = !manualEnabled && !stripeEnabled;
  const defaultMethod: "manual" | "stripe_card" = manualEnabled ? "manual" : "stripe_card";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"manual" | "stripe_card">(defaultMethod);
  const [promoCode, setPromoCode] = useState("");
  const [discount, setDiscount] = useState<DiscountResult | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Auto-redirect to home if cart is empty (e.g., after submission or direct link)
  useEffect(() => {
    if (cart.cartLines.length === 0) {
      const t = setTimeout(() => {
        navigate({ to: "/s/$slug", params: { slug } });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [cart.cartLines.length, navigate, slug]);

  const subtotalCents = cart.totalCents;
  const discountCents = discount && discount.valid ? discount.discount_cents : 0;
  const finalTotalCents = Math.max(0, subtotalCents - discountCents);

  async function applyPromo() {
    const code = promoCode.trim();
    if (!code) return;
    setValidatingPromo(true);
    setDiscount(null);
    try {
      const { data, error } = await supabase.rpc("validate_discount_code", {
        _slug: slug,
        _code: code,
        _order_total_cents: subtotalCents,
        _customer_email: email.trim() || "guest@example.com",
      });
      if (error) throw error;
      const result = data as unknown as DiscountResult;
      setDiscount(result);
      if (result.valid) {
        toast.success(`Промокод застосовано: -${formatMoneyExact(result.discount_cents)}`);
      } else {
        const messages: Record<string, string> = {
          store_not_found: "Магазин не знайдено",
          invalid_or_expired: "Промокод недійсний або прострочений",
          below_minimum: `Мінімальна сума замовлення: ${
            result.min_cents ? formatMoneyExact(result.min_cents) : ""
          }`,
        };
        toast.error(messages[result.error] ?? "Не вдалося застосувати промокод");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Помилка валідації");
    } finally {
      setValidatingPromo(false);
    }
  }

  async function placeOrder() {
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    if (!trimmedEmail || cart.cartLines.length === 0) return;

    if (trimmedEmail.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Введіть коректний email");
      return;
    }
    if (trimmedName.length > 200) {
      toast.error("Ім'я задовге");
      return;
    }
    if (cart.cartLines.length > 50) {
      toast.error("Забагато товарів у кошику");
      return;
    }
    if (method === "stripe_card") {
      toast.error("Картка з'явиться невдовзі — оберіть переказ.");
      return;
    }

    setSubmitting(true);
    try {
      const items = cart.cartLines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
      }));
      const { data: orderId, error: rpcErr } = await supabase.rpc("place_storefront_order", {
        _tenant_id: cart.tenantId,
        _customer_name: trimmedName,
        _customer_email: trimmedEmail,
        _items: items,
        _payment_method: "manual",
      });
      if (rpcErr) throw rpcErr;
      if (!orderId) throw new Error("Не вдалося створити замовлення");

      track(cart.tenantId, "purchase_completed", {
        order_id: orderId,
        payload: {
          total_cents: finalTotalCents,
          items: items.length,
          currency: cart.currency,
          payment_method: "manual",
          status: "pending",
          promo_code: discount?.valid ? promoCode.trim().toUpperCase() : null,
          discount_cents: discountCents,
        },
      });

      toast.success("Замовлення створено!");
      cart.clear();
      navigate({ to: "/s/$slug/orders/$orderId", params: { slug, orderId } });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Невідома помилка";
      const friendly = raw.includes("invalid_email")
        ? "Невірний email"
        : raw.includes("insufficient_stock")
          ? "Деяких товарів немає в наявності — оновіть сторінку."
          : raw.includes("invalid_product")
            ? "Деякі товари недоступні."
            : raw.includes("tenant_inactive") || raw.includes("invalid_tenant")
              ? "Магазин зараз недоступний."
              : "Не вдалося оформити замовлення. Спробуйте ще раз.";
      toast.error(friendly);
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.cartLines.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">Кошик порожній.</p>
        <Link
          to="/s/$slug"
          params={{ slug }}
          className="mt-4 inline-flex text-sm text-primary hover:underline"
        >
          ← До магазину
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/s/$slug"
        params={{ slug }}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Продовжити покупки
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-foreground">Оформлення замовлення</h1>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Cart summary editable */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Ваше замовлення</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {cart.cartLines.map(({ product, quantity }) => (
                <div key={product.id} className="flex items-center gap-3">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted" />
                  )}
                  <div className="flex-1">
                    <p className="line-clamp-1 text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatMoneyExact(product.price_cents)} × {quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => cart.updateQty(product.id, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => cart.updateQty(product.id, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => cart.removeLine(product.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Contacts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Контактні дані</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="co-name">Ім'я</Label>
                <Input
                  id="co-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ваше ім'я"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="co-email">Email *</Label>
                <Input
                  id="co-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={submitting}
                />
              </div>
            </CardContent>
          </Card>

          {/* Payment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Метод оплати</CardTitle>
            </CardHeader>
            <CardContent>
              {noMethods ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  Жодний метод оплати не налаштовано.
                </p>
              ) : (
                <RadioGroup
                  value={method}
                  onValueChange={(v) => setMethod(v as "manual" | "stripe_card")}
                  className="space-y-2"
                >
                  {manualEnabled && (
                    <label
                      htmlFor="pm-manual"
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/50"
                    >
                      <RadioGroupItem id="pm-manual" value="manual" className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Landmark className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Банківський переказ</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Інструкції з'являться після оформлення.
                        </p>
                      </div>
                    </label>
                  )}
                  {stripeEnabled && (
                    <label
                      htmlFor="pm-stripe"
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 opacity-60 hover:bg-accent/50"
                    >
                      <RadioGroupItem id="pm-stripe" value="stripe_card" className="mt-1" disabled />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Картка</span>
                          <Badge variant="outline" className="text-[10px]">
                            Скоро
                          </Badge>
                        </div>
                      </div>
                    </label>
                  )}
                </RadioGroup>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar — totals & promo */}
        <aside className="space-y-4 md:sticky md:top-20 md:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Підсумок</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Сума</span>
                  <span className="tabular-nums">{formatMoneyExact(subtotalCents)}</span>
                </div>
                {discount?.valid && (
                  <div className="flex justify-between text-primary">
                    <span>Знижка</span>
                    <span className="tabular-nums">−{formatMoneyExact(discount.discount_cents)}</span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="Промокод"
                      className="h-9 pl-8 text-sm uppercase"
                      disabled={validatingPromo || submitting}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={applyPromo}
                    disabled={!promoCode.trim() || validatingPromo || submitting}
                  >
                    {validatingPromo ? <Loader2 className="h-3 w-3 animate-spin" /> : "OK"}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">До сплати</span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoneyExact(finalTotalCents)}
                </span>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={placeOrder}
                disabled={
                  submitting || !email.trim() || noMethods || method === "stripe_card"
                }
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Оформити замовлення
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                Натиснувши «Оформити», ви погоджуєтеся з умовами магазину.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
