/**
 * LiqPay (Privat24) — server-only helpers.
 *
 * Документація: https://www.liqpay.ua/documentation/api
 *
 * Підпис: base64( SHA1( private_key + data + private_key ) ),
 * де data = base64(JSON.stringify(params)).
 *
 * Server only — private_key НЕ можна виставляти клієнту.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const LIQPAY_CHECKOUT_URL = "https://www.liqpay.ua/api/3/checkout";

export type LiqPayParams = {
  publicKey: string;
  privateKey: string;
  amount: number; // у валюті (наприклад 350.50 UAH)
  currency: string; // UAH | USD | EUR
  description: string;
  orderId: string;
  resultUrl: string; // куди редіректнути користувача після оплати (UI)
  serverUrl: string; // куди LiqPay POST'не webhook
  /** Тестовий режим LiqPay (тенант явно ввімкнув liqpay_sandbox у конфігу). */
  sandbox?: boolean;
};

export type LiqPayInitOutput = {
  data: string;
  signature: string;
  checkoutUrl: string;
};

function base64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

function sha1Base64(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("base64");
}

export function buildLiqPayCheckout(p: LiqPayParams): LiqPayInitOutput {
  const params = {
    public_key: p.publicKey,
    version: 3,
    action: "pay",
    amount: Number(p.amount.toFixed(2)),
    currency: p.currency,
    description: p.description,
    order_id: p.orderId,
    result_url: p.resultUrl,
    server_url: p.serverUrl,
    sandbox: p.sandbox ? 1 : 0,
  };
  const data = base64(JSON.stringify(params));
  const signature = sha1Base64(p.privateKey + data + p.privateKey);
  return { data, signature, checkoutUrl: LIQPAY_CHECKOUT_URL };
}

export function verifyLiqPaySignature(
  privateKey: string,
  data: string,
  signature: string,
): boolean {
  if (!data || !signature || !privateKey) return false;
  const expected = Buffer.from(sha1Base64(privateKey + data + privateKey), "utf8");
  const actual = Buffer.from(signature, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type LiqPayCallbackPayload = {
  status: string; // success | failure | error | reversed | sandbox | wait_accept | ...
  order_id: string;
  amount: number;
  currency: string;
  transaction_id?: number | string;
  payment_id?: number | string;
  err_code?: string;
  err_description?: string;
};

export function parseLiqPayCallback(data: string): LiqPayCallbackPayload {
  const json = Buffer.from(data, "base64").toString("utf8");
  return JSON.parse(json) as LiqPayCallbackPayload;
}

/**
 * Статуси, які зараховуємо як оплату.
 *
 * - "success" — оплата пройшла;
 * - "wait_compensation" — гроші списані з покупця, очікують розрахунку
 *   з мерчантом (фактично оплачено);
 * - "sandbox" — ЛИШЕ якщо тенант явно ввімкнув liqpay_sandbox у конфігу,
 *   інакше тестовий callback не може позначити реальне замовлення оплаченим.
 */
export function isLiqPaySuccess(status: string, allowSandbox = false): boolean {
  if (status === "success" || status === "wait_compensation") return true;
  return allowSandbox && status === "sandbox";
}
