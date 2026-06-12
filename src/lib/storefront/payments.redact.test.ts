import { describe, expect, it } from "vitest";

import { STOREFRONT_PUBLIC_PAYMENT_FIELDS, redactStorefrontPayments } from "./loaders";

const SECRET_KEYS = [
  "liqpay_private_key",
  "liqpay_public_key",
  "wayforpay_secret_key",
  "wayforpay_merchant_account",
  "wayforpay_merchant_domain",
  "monobank_token",
];

describe("redactStorefrontPayments", () => {
  it("keeps only whitelisted public fields", () => {
    const full = {
      manual_enabled: true,
      stripe_enabled: false,
      liqpay_enabled: true,
      wayforpay_enabled: true,
      monobank_enabled: false,
      manual_instructions: "Картка 0000",
      manual_contact: "+380",
      currency: "UAH",
      // secrets that must be stripped
      liqpay_private_key: "PRIV_SECRET",
      liqpay_public_key: "i123",
      wayforpay_secret_key: "WFP_SECRET",
      wayforpay_merchant_account: "merch",
      wayforpay_merchant_domain: "shop.example",
      monobank_token: "MONO_TOKEN",
    };
    const out = redactStorefrontPayments(full) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([...STOREFRONT_PUBLIC_PAYMENT_FIELDS].sort());
    expect(out.manual_instructions).toBe("Картка 0000");
    expect(out.currency).toBe("UAH");
  });

  it("never leaks any secret key", () => {
    const full: Record<string, unknown> = { currency: "UAH" };
    for (const k of SECRET_KEYS) full[k] = "LEAK";
    const out = redactStorefrontPayments(full) as Record<string, unknown>;
    for (const k of SECRET_KEYS) {
      expect(k in out).toBe(false);
    }
    expect(JSON.stringify(out)).not.toContain("LEAK");
  });

  it("handles null/undefined/empty gracefully", () => {
    expect(redactStorefrontPayments(null)).toEqual({});
    expect(redactStorefrontPayments(undefined)).toEqual({});
    expect(redactStorefrontPayments({})).toEqual({});
  });

  it("omits absent fields rather than adding undefined", () => {
    const out = redactStorefrontPayments({ currency: "USD" }) as Record<string, unknown>;
    expect(out).toEqual({ currency: "USD" });
    expect("manual_enabled" in out).toBe(false);
  });
});
