/**
 * Monobank Acquiring — server-only helpers.
 *
 * Документація: https://api.monobank.ua/docs/acquiring.html
 *
 * Підхід: створюємо invoice (POST /api/merchant/invoice/create),
 * Monobank повертає { pageUrl, invoiceId } — редіректимо користувача.
 * Webhook callback: POST на webHookUrl, підпис через ECDSA (verify через
 * /api/merchant/pubkey). Для простоти валідуємо callback через статус-перевірку
 * (POST до /api/merchant/invoice/status?invoiceId=...).
 */

const MONO_API_BASE = "https://api.monobank.ua";

export type MonoCreateInvoiceParams = {
  token: string;
  amountCents: number; // в копійках
  currency: number; // ISO 4217 numeric: UAH=980, USD=840, EUR=978
  orderRef: string;
  validity?: number; // seconds
  webHookUrl: string;
  redirectUrl: string;
  destination: string; // призначення платежу
  reference?: string;
};

export type MonoCreateInvoiceResult =
  | { ok: true; invoiceId: string; pageUrl: string }
  | { ok: false; error: string; status?: number };

export async function createMonoInvoice(
  p: MonoCreateInvoiceParams,
): Promise<MonoCreateInvoiceResult> {
  try {
    const body = {
      amount: p.amountCents,
      ccy: p.currency,
      merchantPaymInfo: {
        reference: p.reference ?? p.orderRef,
        destination: p.destination,
      },
      redirectUrl: p.redirectUrl,
      webHookUrl: p.webHookUrl,
      validity: p.validity ?? 3600,
    };
    const res = await fetch(`${MONO_API_BASE}/api/merchant/invoice/create`, {
      method: "POST",
      headers: {
        "X-Token": p.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: txt.slice(0, 500), status: res.status };
    }
    const json = (await res.json()) as { invoiceId?: string; pageUrl?: string };
    if (!json.invoiceId || !json.pageUrl) {
      return { ok: false, error: "missing_invoice_fields" };
    }
    return { ok: true, invoiceId: json.invoiceId, pageUrl: json.pageUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export type MonoInvoiceStatus = {
  invoiceId: string;
  status: "created" | "processing" | "hold" | "success" | "failure" | "reversed" | "expired";
  amount: number;
  ccy: number;
  reference?: string;
  destination?: string;
  failureReason?: string;
  modifiedDate?: string;
};

export async function getMonoInvoiceStatus(
  token: string,
  invoiceId: string,
): Promise<MonoInvoiceStatus | null> {
  try {
    const url = `${MONO_API_BASE}/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`;
    const res = await fetch(url, { headers: { "X-Token": token } });
    if (!res.ok) return null;
    return (await res.json()) as MonoInvoiceStatus;
  } catch {
    return null;
  }
}

export function currencyCodeNumeric(code: string): number {
  switch (code.toUpperCase()) {
    case "UAH":
      return 980;
    case "USD":
      return 840;
    case "EUR":
      return 978;
    default:
      return 980;
  }
}

export function isMonoSuccess(status: string): boolean {
  return status === "success" || status === "hold";
}

/**
 * Строге зіставлення валюти замовлення з ISO-4217 numeric кодом callback'а.
 * Невідома валюта замовлення → false (на відміну від currencyCodeNumeric,
 * який дефолтить до UAH і підходить лише для init-шляху).
 */
export function monoCcyMatchesOrderCurrency(ccy: number, orderCurrency: string | null): boolean {
  switch ((orderCurrency || "UAH").toUpperCase()) {
    case "UAH":
      return ccy === 980;
    case "USD":
      return ccy === 840;
    case "EUR":
      return ccy === 978;
    default:
      return false;
  }
}
