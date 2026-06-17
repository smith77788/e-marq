import { describe, expect, it } from "vitest";

import { churnProbabilityFromCycles, ltvConfidence } from "./ltvMath";

describe("churnProbabilityFromCycles", () => {
  it("is low when the customer is on-cycle and high when long overdue", () => {
    expect(churnProbabilityFromCycles(0)).toBeLessThan(0.1);
    expect(churnProbabilityFromCycles(1.5)).toBeCloseTo(0.5, 1);
    expect(churnProbabilityFromCycles(3)).toBeGreaterThan(0.9);
  });

  it("is monotonic — more cycles overdue never lowers churn", () => {
    let prev = -1;
    for (let c = 0; c <= 5; c += 0.25) {
      const p = churnProbabilityFromCycles(c);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("stays within the clamped 0.02..0.97 range", () => {
    for (const c of [-5, 0, 1, 2, 10, 100, Infinity, NaN]) {
      const p = churnProbabilityFromCycles(c);
      expect(p).toBeGreaterThanOrEqual(0.02);
      expect(p).toBeLessThanOrEqual(0.97);
    }
  });

  it("has no discrete jumps (smooth across a tier boundary)", () => {
    // old ladder jumped 0.3 -> 0.55 at exactly 1.5; the curve must not.
    const a = churnProbabilityFromCycles(1.49);
    const b = churnProbabilityFromCycles(1.51);
    expect(Math.abs(b - a)).toBeLessThan(0.05);
  });
});

describe("ltvConfidence", () => {
  it("rises with order history and is capped at 0.9", () => {
    expect(ltvConfidence(1)).toBeLessThan(ltvConfidence(3));
    expect(ltvConfidence(5)).toBe(0.9);
    expect(ltvConfidence(50)).toBe(0.9);
  });

  it("never drops below 0.3, even for zero/invalid history", () => {
    expect(ltvConfidence(0)).toBeGreaterThanOrEqual(0.3);
    expect(ltvConfidence(-3)).toBeGreaterThanOrEqual(0.3);
    expect(ltvConfidence(NaN)).toBeGreaterThanOrEqual(0.3);
  });

  it("a one-order customer is meaningfully less confident than the cap", () => {
    expect(ltvConfidence(1)).toBeLessThan(0.6);
  });
});
