import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildLiqPayCheckout,
  isLiqPaySuccess,
  parseLiqPayCallback,
  verifyLiqPaySignature,
} from "./liqpay.server";
import { currencyCodeNumeric, isMonoSuccess, monoCcyMatchesOrderCurrency } from "./monobank.server";
import {
  isWayForPaySuccess,
  verifyWayForPayCallback,
  type WayForPayCallback,
} from "./wayforpay.server";

const PRIVATE_KEY = "test_private_key";

describe("liqpay signature", () => {
  const checkout = buildLiqPayCheckout({
    publicKey: "pub",
    privateKey: PRIVATE_KEY,
    amount: 350.5,
    currency: "UAH",
    description: "Test order",
    orderId: "11111111-2222-3333-4444-555555555555",
    resultUrl: "https://shop.example/result",
    serverUrl: "https://shop.example/callback",
  });

  it("accepts a signature produced by buildLiqPayCheckout", () => {
    expect(verifyLiqPaySignature(PRIVATE_KEY, checkout.data, checkout.signature)).toBe(true);
  });

  it("rejects tampered data", () => {
    const tampered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(checkout.data, "base64").toString("utf8")),
        amount: 1,
      }),
      "utf8",
    ).toString("base64");
    expect(verifyLiqPaySignature(PRIVATE_KEY, tampered, checkout.signature)).toBe(false);
  });

  it("rejects signature of a different length", () => {
    expect(verifyLiqPaySignature(PRIVATE_KEY, checkout.data, checkout.signature + "x")).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(verifyLiqPaySignature("", checkout.data, checkout.signature)).toBe(false);
    expect(verifyLiqPaySignature(PRIVATE_KEY, "", checkout.signature)).toBe(false);
    expect(verifyLiqPaySignature(PRIVATE_KEY, checkout.data, "")).toBe(false);
  });

  it("parseLiqPayCallback decodes base64 JSON", () => {
    const payload = { status: "success", order_id: "abc", amount: 10, currency: "UAH" };
    const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    expect(parseLiqPayCallback(data)).toEqual(payload);
  });

  it("isLiqPaySuccess documents current accepted statuses", () => {
    expect(isLiqPaySuccess("success")).toBe(true);
    expect(isLiqPaySuccess("failure")).toBe(false);
    expect(isLiqPaySuccess("error")).toBe(false);
    expect(isLiqPaySuccess("reversed")).toBe(false);
    // спірні, чекають рішення (див. ревю 2026-06-12): прийняті зараз
    expect(isLiqPaySuccess("sandbox")).toBe(true);
    expect(isLiqPaySuccess("wait_compensation")).toBe(true);
  });
});

describe("wayforpay callback signature", () => {
  const SECRET = "wfp_secret";

  function sign(payload: Omit<WayForPayCallback, "merchantSignature">, amountStr: string): string {
    const src = [
      payload.merchantAccount,
      payload.orderReference,
      amountStr,
      payload.currency,
      payload.authCode ?? "",
      payload.cardPan ?? "",
      payload.transactionStatus,
      String(payload.reasonCode ?? ""),
    ].join(";");
    return createHmac("md5", SECRET).update(src, "utf8").digest("hex");
  }

  const base: Omit<WayForPayCallback, "merchantSignature"> = {
    merchantAccount: "merchant_test",
    orderReference: "11111111-2222-3333-4444-555555555555",
    amount: 1500,
    currency: "UAH",
    authCode: "123456",
    cardPan: "44****1111",
    transactionStatus: "Approved",
    reasonCode: 1100,
  };

  it("accepts amount signed as integer string (1500)", () => {
    const payload = { ...base, merchantSignature: sign(base, "1500") };
    expect(verifyWayForPayCallback(SECRET, payload)).toBe(true);
  });

  it("accepts amount signed with decimals (1500.00)", () => {
    const payload = { ...base, merchantSignature: sign(base, "1500.00") };
    expect(verifyWayForPayCallback(SECRET, payload)).toBe(true);
  });

  it("accepts fractional amount (1547.36)", () => {
    const fractional = { ...base, amount: 1547.36 };
    const payload = { ...fractional, merchantSignature: sign(fractional, "1547.36") };
    expect(verifyWayForPayCallback(SECRET, payload)).toBe(true);
  });

  it("rejects wrong secret", () => {
    const payload = { ...base, merchantSignature: sign(base, "1500") };
    expect(verifyWayForPayCallback("other_secret", payload)).toBe(false);
  });

  it("rejects tampered amount", () => {
    const payload = { ...base, amount: 1, merchantSignature: sign(base, "1500") };
    expect(verifyWayForPayCallback(SECRET, payload)).toBe(false);
  });

  it("rejects tampered status", () => {
    const payload = {
      ...base,
      transactionStatus: "Approved",
      merchantSignature: sign({ ...base, transactionStatus: "Declined" }, "1500"),
    };
    expect(verifyWayForPayCallback(SECRET, payload)).toBe(false);
  });

  it("rejects missing signature", () => {
    const payload = { ...base, merchantSignature: "" };
    expect(verifyWayForPayCallback(SECRET, payload)).toBe(false);
  });

  it("isWayForPaySuccess accepts Approved and InProcessing only", () => {
    expect(isWayForPaySuccess("Approved")).toBe(true);
    expect(isWayForPaySuccess("InProcessing")).toBe(true);
    expect(isWayForPaySuccess("Declined")).toBe(false);
    expect(isWayForPaySuccess("Refunded")).toBe(false);
  });
});

describe("monobank currency", () => {
  it("currencyCodeNumeric maps known currencies and defaults to UAH", () => {
    expect(currencyCodeNumeric("UAH")).toBe(980);
    expect(currencyCodeNumeric("usd")).toBe(840);
    expect(currencyCodeNumeric("EUR")).toBe(978);
    expect(currencyCodeNumeric("PLN")).toBe(980);
  });

  it("monoCcyMatchesOrderCurrency is strict", () => {
    expect(monoCcyMatchesOrderCurrency(980, "UAH")).toBe(true);
    expect(monoCcyMatchesOrderCurrency(980, null)).toBe(true); // замовлення без валюти = UAH
    expect(monoCcyMatchesOrderCurrency(840, "USD")).toBe(true);
    expect(monoCcyMatchesOrderCurrency(978, "eur")).toBe(true);
    expect(monoCcyMatchesOrderCurrency(840, "UAH")).toBe(false);
    expect(monoCcyMatchesOrderCurrency(980, "USD")).toBe(false);
    // невідома валюта замовлення ніколи не збігається — на відміну від
    // currencyCodeNumeric, який дефолтить до 980
    expect(monoCcyMatchesOrderCurrency(980, "PLN")).toBe(false);
  });

  it("isMonoSuccess accepts success and hold only", () => {
    expect(isMonoSuccess("success")).toBe(true);
    expect(isMonoSuccess("hold")).toBe(true);
    expect(isMonoSuccess("processing")).toBe(false);
    expect(isMonoSuccess("failure")).toBe(false);
    expect(isMonoSuccess("reversed")).toBe(false);
    expect(isMonoSuccess("expired")).toBe(false);
  });
});
