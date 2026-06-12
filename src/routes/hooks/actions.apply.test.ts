import { describe, expect, it } from "vitest";

/**
 * Чисті хелпери winback_touch, винесені для тестування без БД.
 * Дублюють інлайн-логіку в actions.apply.ts (генератор коду + кліп знижки),
 * щоб зафіксувати інваріанти; сам side-effect (insert у promotions/outbound)
 * перевіряється в інтеграційному прогоні.
 */
function generateWinbackCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "WB-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function clipDiscountPct(suggested: number | undefined): number {
  return Math.min(50, Math.max(5, Math.round(suggested ?? 15)));
}

describe("winback code generator", () => {
  it("always starts with WB- and has 6 code chars", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateWinbackCode();
      expect(code).toMatch(/^WB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it("excludes ambiguous characters (0, O, 1, I)", () => {
    for (let i = 0; i < 50; i++) {
      const body = generateWinbackCode().slice(3);
      expect(body).not.toMatch(/[0O1I]/);
    }
  });
});

describe("winback discount clip", () => {
  it("defaults to 15 when unset", () => {
    expect(clipDiscountPct(undefined)).toBe(15);
  });

  it("clamps into the 5..50 range", () => {
    expect(clipDiscountPct(0)).toBe(5);
    expect(clipDiscountPct(3)).toBe(5);
    expect(clipDiscountPct(15)).toBe(15);
    expect(clipDiscountPct(50)).toBe(50);
    expect(clipDiscountPct(80)).toBe(50);
  });

  it("rounds fractional suggestions", () => {
    expect(clipDiscountPct(12.4)).toBe(12);
    expect(clipDiscountPct(12.6)).toBe(13);
  });
});
