import { describe, expect, it } from "vitest";

import {
  HRYVNIA,
  formatMoney,
  formatMoneyCompact,
  formatMoneyExact,
  formatNumber,
} from "./money";

/**
 * Invariant tests for money rendering. Assertions avoid exact locale glyphs
 * (grouping/space characters differ across ICU builds) and instead lock the
 * behaviour that matters: cents->hryvnia rounding, null safety, and that the
 * hryvnia symbol is always present. money.ts is used across every total/KPI,
 * so a regression here is a revenue-visible bug.
 */
describe("formatMoney (whole hryvnia)", () => {
  it("rounds cents to the nearest hryvnia", () => {
    expect(formatMoney(12345)).toContain("123");
    expect(formatMoney(12399)).toContain("124"); // 123.99 -> 124
    expect(formatMoney(12350)).toContain("124"); // .50 rounds up
    expect(formatMoney(12349)).toContain("123");
  });

  it("treats null/undefined as zero", () => {
    expect(formatMoney(null)).toBe(formatMoney(0));
    expect(formatMoney(undefined)).toBe(formatMoney(0));
  });

  it("always includes the hryvnia symbol", () => {
    expect(formatMoney(1000)).toContain(HRYVNIA);
    expect(formatMoney(0)).toContain(HRYVNIA);
  });

  it("renders zero as a value containing 0", () => {
    expect(formatMoney(0)).toContain("0");
  });
});

describe("formatMoneyExact (2 decimals)", () => {
  it("keeps kopiyky precision without rounding to whole", () => {
    expect(formatMoneyExact(12345)).toContain("123");
    // 123.45 -> the fractional part is preserved (45), regardless of separator
    expect(formatMoneyExact(12345)).toMatch(/45/);
  });

  it("null safe", () => {
    expect(formatMoneyExact(null)).toBe(formatMoneyExact(0));
  });

  it("does not lose a half-kopiyka edge", () => {
    expect(formatMoneyExact(1)).toMatch(/01/); // 0.01
  });
});

describe("formatMoneyCompact", () => {
  it("appends the hryvnia symbol", () => {
    expect(formatMoneyCompact(1_000_00)).toContain(HRYVNIA);
  });

  it("null safe", () => {
    expect(formatMoneyCompact(null)).toBe(formatMoneyCompact(0));
  });
});

describe("formatNumber", () => {
  it("renders integers and is null safe", () => {
    expect(formatNumber(1234)).toContain("1");
    expect(formatNumber(null)).toBe(formatNumber(0));
  });
});
