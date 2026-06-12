/**
 * Спільні типи для українських платіжних шлюзів.
 */

export type PaymentProvider = "liqpay" | "wayforpay" | "monobank";

export type PaymentInitRequest = {
  orderId: string;
  tenantId: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string;
};

export type PaymentInitResult =
  | {
      ok: true;
      provider: PaymentProvider;
      /** Куди редіректити браузер користувача (для всіх 3х шлюзів — окрема сторінка). */
      redirectUrl?: string;
      /** Для LiqPay — { data, signature } для self-submit form. */
      formFields?: Record<string, string>;
      /** Для WayForPay — поля форми, що сабмітяться POST на checkout URL. */
      formAction?: string;
      intentId: string;
    }
  | { ok: false; error: string };

export type GatewayConfig = {
  liqpay_enabled: boolean;
  liqpay_public_key: string;
  liqpay_private_key: string;
  /**
   * Тестовий режим LiqPay для цього tenant'а: checkout створюється з
   * sandbox=1, а callback зі статусом "sandbox" зараховується як оплата.
   * Без прапорця sandbox-callback НІКОЛИ не позначає замовлення оплаченим.
   */
  liqpay_sandbox: boolean;
  wayforpay_enabled: boolean;
  wayforpay_merchant_account: string;
  wayforpay_secret_key: string;
  wayforpay_merchant_domain: string;
  monobank_enabled: boolean;
  monobank_token: string;
};

export function readGatewayConfig(features: unknown): GatewayConfig {
  const f = (features ?? {}) as Record<string, unknown>;
  const p = (f.payments ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const b = (v: unknown) => v === true;
  return {
    liqpay_enabled: b(p.liqpay_enabled),
    liqpay_public_key: s(p.liqpay_public_key),
    liqpay_private_key: s(p.liqpay_private_key),
    liqpay_sandbox: b(p.liqpay_sandbox),
    wayforpay_enabled: b(p.wayforpay_enabled),
    wayforpay_merchant_account: s(p.wayforpay_merchant_account),
    wayforpay_secret_key: s(p.wayforpay_secret_key),
    wayforpay_merchant_domain: s(p.wayforpay_merchant_domain),
    monobank_enabled: b(p.monobank_enabled),
    monobank_token: s(p.monobank_token),
  };
}
