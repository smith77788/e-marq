/**
 * WayForPay — server-only helpers.
 *
 * Документація: https://wiki.wayforpay.com/uk/view/852102
 *
 * Підпис форми: HMAC-MD5 з конкатенації полів через ';':
 *   merchantAccount;merchantDomainName;orderReference;orderDate;amount;currency;
 *   productName[0];productName[1];...;productCount[0];...;productPrice[0];...
 *
 * Підпис відповіді webhook (orderReference;status;time):
 *   HMAC-MD5(merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode)
 */
import { createHmac } from "node:crypto";

const WAYFORPAY_CHECKOUT_URL = "https://secure.wayforpay.com/pay";

export type WayForPayProduct = {
  name: string;
  price: number; // у валюті
  count: number;
};

export type WayForPayParams = {
  merchantAccount: string;
  merchantDomainName: string;
  secretKey: string;
  orderReference: string;
  amount: number;
  currency: string;
  products: WayForPayProduct[];
  clientEmail?: string;
  clientFirstName?: string;
  serviceUrl: string; // webhook
  returnUrl: string; // після оплати редірект
  language?: string;
};

export type WayForPayFormFields = Record<string, string>;

function md5Hmac(secret: string, data: string): string {
  return createHmac("md5", secret).update(data, "utf8").digest("hex");
}

export function buildWayForPayForm(p: WayForPayParams): {
  action: string;
  fields: WayForPayFormFields;
} {
  const orderDate = Math.floor(Date.now() / 1000);
  const productNames = p.products.map((x) => x.name);
  const productCounts = p.products.map((x) => String(x.count));
  const productPrices = p.products.map((x) => Number(x.price.toFixed(2)).toString());

  const signatureSrc = [
    p.merchantAccount,
    p.merchantDomainName,
    p.orderReference,
    String(orderDate),
    Number(p.amount.toFixed(2)).toString(),
    p.currency,
    ...productNames,
    ...productCounts,
    ...productPrices,
  ].join(";");

  const signature = md5Hmac(p.secretKey, signatureSrc);

  const fields: WayForPayFormFields = {
    merchantAccount: p.merchantAccount,
    merchantDomainName: p.merchantDomainName,
    merchantSignature: signature,
    orderReference: p.orderReference,
    orderDate: String(orderDate),
    amount: Number(p.amount.toFixed(2)).toString(),
    currency: p.currency,
    serviceUrl: p.serviceUrl,
    returnUrl: p.returnUrl,
    language: p.language ?? "UA",
    merchantAuthType: "SimpleSignature",
    merchantTransactionType: "AUTH",
    merchantTransactionSecureType: "AUTO",
  };

  if (p.clientEmail) fields.clientEmail = p.clientEmail;
  if (p.clientFirstName) fields.clientFirstName = p.clientFirstName;

  p.products.forEach((prod, i) => {
    fields[`productName[${i}]`] = prod.name;
    fields[`productPrice[${i}]`] = Number(prod.price.toFixed(2)).toString();
    fields[`productCount[${i}]`] = String(prod.count);
  });

  return { action: WAYFORPAY_CHECKOUT_URL, fields };
}

export type WayForPayCallback = {
  merchantAccount: string;
  orderReference: string;
  amount: number;
  currency: string;
  authCode?: string;
  cardPan?: string;
  transactionStatus: string;
  reasonCode?: number | string;
  merchantSignature: string;
  processingDate?: number;
};

export function verifyWayForPayCallback(
  secretKey: string,
  payload: WayForPayCallback,
): boolean {
  const src = [
    payload.merchantAccount,
    payload.orderReference,
    Number(payload.amount.toFixed(2)).toString(),
    payload.currency,
    payload.authCode ?? "",
    payload.cardPan ?? "",
    payload.transactionStatus,
    String(payload.reasonCode ?? ""),
  ].join(";");
  const expected = md5Hmac(secretKey, src);
  if (expected.length !== payload.merchantSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ payload.merchantSignature.charCodeAt(i);
  }
  return diff === 0;
}

export function buildWayForPayAck(secretKey: string, orderReference: string): {
  orderReference: string;
  status: "accept";
  time: number;
  signature: string;
} {
  const time = Math.floor(Date.now() / 1000);
  const src = [orderReference, "accept", String(time)].join(";");
  return {
    orderReference,
    status: "accept",
    time,
    signature: md5Hmac(secretKey, src),
  };
}

export function isWayForPaySuccess(status: string): boolean {
  return status === "Approved" || status === "InProcessing";
}
