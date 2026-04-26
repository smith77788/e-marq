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
  Award,
  CreditCard,
  Landmark,
  Loader2,
  Smartphone,
  Sparkles,
  Tag,
  Trash2,
  Wallet,
  X,
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
import { ShippingSelector } from "@/components/storefront/ShippingSelector";
import type { NPSelection } from "@/lib/shipping/novaPoshta";
import { sendOrderConfirmationEmail } from "@/lib/email/client";
import { startGatewayPayment, type PaymentMethod } from "@/lib/payments/client";

type DiscountResult =
  | { valid: true; promo_id: string; name: string; type: string; discount_cents: number }
  | { valid: false; error: string; min_cents?: number };

type LoyaltyValidation =
  | {
      valid: true;
      discount_cents: number;
      points_used: number;
      balance_after: number;
    }
  | {
      valid: false;
      error: string;
      min_points?: number;
      balance_points?: number;
    };

type LoyaltyState = {
  programActive: boolean;
  pointsPer100: number;
  uahPerPoint: number;
  minRedeem: number;
  balance: number;
  tier: string;
};

export const Route = createFileRoute("/s/$slug/checkout")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: () => ({
    meta: [{ title: "Оформлення замовлення" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка: {error.message}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Магазин не знайдено.</p>
      <Link to="/" className="mt-3 inline-flex text-sm text-primary underline">
        На головну
      </Link>
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

  const payments = (shell.config.features?.payments ?? {
    manual_enabled: true,
  }) as Record<string, unknown>;

  const manualEnabled = payments.manual_enabled !== false;
  const liqpayEnabled = payments.liqpay_enabled === true;
  const wayforpayEnabled = payments.wayforpay_enabled === true;
  const monobankEnabled = payments.monobank_enabled === true;
  const availableMethods: PaymentMethod[] = [
    ...(manualEnabled ? (["manual"] as const) : []),
    ...(liqpayEnabled ? (["liqpay"] as const) : []),
    ...(wayforpayEnabled ? (["wayforpay"] as const) : []),
    ...(monobankEnabled ? (["monobank"] as const) : []),
  ];
  const noMethods = availableMethods.length === 0;
  const defaultMethod: PaymentMethod = availableMethods[0] ?? "manual";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shipping, setShipping] = useState<NPSelection | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [promoCode, setPromoCode] = useState("");
  const [discount, setDiscount] = useState<DiscountResult | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Loyalty
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null);
  const [loyaltyChecking, setLoyaltyChecking] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [redeemApplied, setRedeemApplied] = useState<{
    points: number;
    discountCents: number;
  } | null>(null);

  const subtotalCents = cart.totalCents;
  const promoDiscountCents = discount && discount.valid ? discount.discount_cents : 0;
  const loyaltyDiscountCents = redeemApplied?.discountCents ?? 0;
  const discountCents = promoDiscountCents + loyaltyDiscountCents;
  const finalTotalCents = Math.max(0, subtotalCents - discountCents);

  // Bали які буде нараховано (передбачення)
  const projectedEarnPoints = loyalty?.programActive
    ? Math.floor(loyalty.pointsPer100 * (finalTotalCents / 10000))
    : 0;

  // Завантаження loyalty стану коли email стабільний
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setLoyalty(null);
      setRedeemApplied(null);
      return;
    }
    let cancelled = false;
    const tid = setTimeout(async () => {
      setLoyaltyChecking(true);
      try {
        const { data: program } = await supabase
          .from("loyalty_programs")
          .select("points_per_100_uah, uah_per_point, min_redeem_points, is_active")
          .eq("tenant_id", cart.tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (!program?.is_active) {
          setLoyalty(null);
          return;
        }
        const { data: account } = await supabase
          .from("loyalty_accounts")
          .select("balance_points, tier")
          .eq("tenant_id", cart.tenantId)
          .eq("customer_email", trimmed)
          .maybeSingle();
        if (cancelled) return;
        setLoyalty({
          programActive: true,
          pointsPer100: program.points_per_100_uah,
          uahPerPoint: Number(program.uah_per_point),
          minRedeem: program.min_redeem_points,
          balance: account?.balance_points ?? 0,
          tier: account?.tier ?? "bronze",
        });
      } finally {
        if (!cancelled) setLoyaltyChecking(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
  }, [email, cart.tenantId]);

  async function applyLoyalty() {
    if (!loyalty) return;
    const pts = parseInt(redeemPoints);
    if (!Number.isFinite(pts) || pts <= 0) {
      toast.error("Введіть кількість балів");
      return;
    }
    setLoyaltyChecking(true);
    try {
      const { data, error } = await supabase.rpc("validate_loyalty_redeem", {
        _tenant_id: cart.tenantId,
        _customer_email: email.trim().toLowerCase(),
        _redeem_points: pts,
        _order_total_cents: subtotalCents - promoDiscountCents,
      });
      if (error) throw error;
      const result = data as unknown as LoyaltyValidation;
      if (result.valid) {
        setRedeemApplied({ points: result.points_used, discountCents: result.discount_cents });
        toast.success(
          `Списано ${result.points_used} балів → −${formatMoneyExact(result.discount_cents)}`,
        );
      } else {
        const messages: Record<string, string> = {
          program_inactive: "Програма лояльності неактивна",
          insufficient_balance: `Недостатньо балів (баланс: ${result.balance_points ?? 0})`,
          below_min_redeem: `Мінімум для списання: ${result.min_points ?? 100} балів`,
          invalid_email: "Введіть email щоб скористатись балами",
          invalid_points: "Введіть коректну кількість",
        };
        toast.error(messages[result.error] ?? "Не вдалося списати бали");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Помилка");
    } finally {
      setLoyaltyChecking(false);
    }
  }

  function clearLoyalty() {
    setRedeemApplied(null);
    setRedeemPoints("");
  }

  // Auto-redirect to home if cart is empty (e.g., after submission or direct link)
  useEffect(() => {
    if (cart.cartLines.length === 0) {
      const t = setTimeout(() => {
        navigate({ to: "/s/$slug", params: { slug } });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [cart.cartLines.length, navigate, slug]);

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
    const trimmedPhone = phone.trim();
    if (!trimmedEmail || cart.cartLines.length === 0) return;

    if (trimmedEmail.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Введіть коректний email");
      return;
    }
    if (trimmedName.length > 200) {
      toast.error("Ім'я задовге");
      return;
    }
    if (trimmedPhone && (trimmedPhone.length > 32 || !/^[+\d\s()-]{6,32}$/.test(trimmedPhone))) {
      toast.error("Введіть коректний телефон");
      return;
    }
    if (!shipping) {
      toast.error("Оберіть місто та відділення Нової Пошти");
      return;
    }
    if (cart.cartLines.length > 50) {
      toast.error("Забагато товарів у кошику");
      return;
    }
    if (!availableMethods.includes(method)) {
      toast.error("Оберіть доступний метод оплати");
      return;
    }

    setSubmitting(true);
    try {
      const items = cart.cartLines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
      }));
      const shippingPayload = {
        method: "nova_poshta",
        phone: trimmedPhone,
        carrier: "nova_poshta",
        city_ref: shipping.cityRef,
        city_name: shipping.cityName,
        warehouse_ref: shipping.warehouseRef,
        warehouse_number: shipping.warehouseNumber,
        warehouse_description: shipping.warehouseDescription,
      };
      const { data: orderId, error: rpcErr } = await supabase.rpc("place_storefront_order", {
        _tenant_id: cart.tenantId,
        _customer_name: trimmedName,
        _customer_email: trimmedEmail,
        _items: items,
        _payment_method: method,
        _shipping: shippingPayload,
        _promo_code: discount?.valid ? promoCode.trim().toUpperCase() : null,
        _loyalty_redeem_points: redeemApplied?.points ?? null,
      });
      if (rpcErr) throw rpcErr;
      if (!orderId) throw new Error("Не вдалося створити замовлення");

      track(cart.tenantId, "purchase_completed", {
        order_id: orderId,
        payload: {
          total_cents: finalTotalCents,
          items: items.length,
          currency: cart.currency,
          payment_method: method,
          status: "pending",
          promo_code: discount?.valid ? promoCode.trim().toUpperCase() : null,
          discount_cents: discountCents,
        },
      });

      // Manual → одразу на сторінку замовлення; gateways → редірект на провайдера
      if (method === "manual") {
        toast.success("Замовлення створено!");
        void sendOrderConfirmationEmail(orderId);
        cart.clear();
        navigate({ to: "/s/$slug/orders/$orderId", params: { slug, orderId } });
      } else {
        // Кошик очищаємо ПЕРЕД редіректом; email прийде з webhook'у після оплати
        cart.clear();
        toast.success("Перенаправляємо на оплату…");
        await startGatewayPayment(method, orderId);
      }
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
                      loading="lazy"
                      decoding="async"
                      width={48}
                      height={48}
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
                      aria-label="Зменшити кількість"
                    >
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => cart.updateQty(product.id, 1)}
                      aria-label="Збільшити кількість"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => cart.removeLine(product.id)}
                      aria-label="Видалити з кошика"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
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
              <div className="space-y-1">
                <Label htmlFor="co-phone">Телефон</Label>
                <Input
                  id="co-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+380 ..."
                  disabled={submitting}
                />
              </div>
            </CardContent>
          </Card>

          {/* Shipping — Nova Poshta */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Доставка · Нова Пошта</CardTitle>
            </CardHeader>
            <CardContent>
              <ShippingSelector value={shipping} onChange={setShipping} disabled={submitting} />
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
                  onValueChange={(v) => setMethod(v as PaymentMethod)}
                  className="space-y-2"
                >
                  {manualEnabled && (
                    <PaymentOption
                      id="pm-manual"
                      value="manual"
                      icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
                      title="Банківський переказ"
                      description="Інструкції з'являться після оформлення."
                    />
                  )}
                  {liqpayEnabled && (
                    <PaymentOption
                      id="pm-liqpay"
                      value="liqpay"
                      icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
                      title="LiqPay · картка"
                      description="Visa / Mastercard, Apple Pay, Google Pay."
                      badge="ПриватБанк"
                    />
                  )}
                  {wayforpayEnabled && (
                    <PaymentOption
                      id="pm-wfp"
                      value="wayforpay"
                      icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                      title="WayForPay · картка"
                      description="Visa / Mastercard, Privat24."
                    />
                  )}
                  {monobankEnabled && (
                    <PaymentOption
                      id="pm-mono"
                      value="monobank"
                      icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
                      title="Monobank"
                      description="Оплата з застосунку Monobank або карткою."
                    />
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
                    <span>Промокод</span>
                    <span className="tabular-nums">
                      −{formatMoneyExact(discount.discount_cents)}
                    </span>
                  </div>
                )}
                {redeemApplied && (
                  <div className="flex justify-between text-primary">
                    <span>Бали лояльності ({redeemApplied.points})</span>
                    <span className="tabular-nums">
                      −{formatMoneyExact(redeemApplied.discountCents)}
                    </span>
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

              {/* Loyalty block — visible only if program is active for this email */}
              {loyalty?.programActive && (
                <>
                  <Separator />
                  <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <Award className="h-3.5 w-3.5 text-primary" />
                        Бали лояльності
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Баланс:{" "}
                        <span className="font-semibold text-foreground tabular-nums">
                          {loyalty.balance}
                        </span>
                      </span>
                    </div>

                    {loyalty.balance >= loyalty.minRedeem ? (
                      redeemApplied ? (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Списано {redeemApplied.points} балів
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={clearLoyalty}
                          >
                            <X className="mr-0.5 h-3 w-3" />
                            Скасувати
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            min={loyalty.minRedeem}
                            max={loyalty.balance}
                            value={redeemPoints}
                            onChange={(e) => setRedeemPoints(e.target.value)}
                            placeholder={`від ${loyalty.minRedeem}`}
                            className="h-8 text-xs tabular-nums"
                            disabled={loyaltyChecking || submitting}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={applyLoyalty}
                            disabled={!redeemPoints || loyaltyChecking || submitting}
                          >
                            {loyaltyChecking ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Списати"
                            )}
                          </Button>
                        </div>
                      )
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Накопичіть {loyalty.minRedeem} балів щоб обміняти на знижку.
                      </p>
                    )}

                    {projectedEarnPoints > 0 && (
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3 w-3 text-primary" />
                        Ви отримаєте{" "}
                        <strong className="text-foreground">{projectedEarnPoints}</strong> балів за
                        це замовлення
                      </p>
                    )}
                  </div>
                </>
              )}

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
                disabled={submitting || !email.trim() || !shipping || noMethods}
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

function PaymentOption({
  id,
  value,
  icon,
  title,
  description,
  badge,
}: {
  id: string;
  value: PaymentMethod;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/50"
    >
      <RadioGroupItem id={id} value={value} className="mt-1" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          {badge && (
            <Badge variant="outline" className="text-[10px]">
              {badge}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}
