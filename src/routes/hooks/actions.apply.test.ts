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

function slugifyTerm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

function clipText(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const clipped = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max);
  return clipped.replace(/[\s,;:.—-]+$/u, "");
}

function buildSeoTitle(pageTitle: string, brandName: string): string {
  const base = pageTitle.trim();
  const withBrand =
    brandName && !base.toLowerCase().includes(brandName.toLowerCase())
      ? `${base} — ${brandName}`
      : base;
  return clipText(withBrand.length <= 60 ? withBrand : base, 60);
}

describe("search-gap slugify", () => {
  it("keeps cyrillic terms (does not strip to empty)", () => {
    expect(slugifyTerm("червона сукня")).toBe("червона-сукня");
  });

  it("collapses punctuation and whitespace into single dashes", () => {
    expect(slugifyTerm("  best  (cheap) dress!! ")).toBe("best-cheap-dress");
  });

  it("never starts or ends with a dash and respects max length", () => {
    const s = slugifyTerm("-" + "довгий запит ".repeat(20));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s).not.toMatch(/^-|-$/);
  });
});

describe("seo text clipping", () => {
  it("returns short strings unchanged", () => {
    expect(clipText("Коротко", 60)).toBe("Коротко");
  });

  it("clips at a word boundary without trailing punctuation", () => {
    const out = clipText("Перше слово друге слово третє слово четверте", 25);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out).not.toMatch(/[\s,;:.—-]$/);
    expect(out).toMatch(/слово$|Перше$/u);
  });
});

describe("seo title builder", () => {
  it("appends brand when missing and within limit", () => {
    expect(buildSeoTitle("Червона сукня", "MARQ")).toBe("Червона сукня — MARQ");
  });

  it("does not duplicate brand already present in title", () => {
    expect(buildSeoTitle("Сукні MARQ — каталог", "MARQ")).toBe("Сукні MARQ — каталог");
  });

  it("drops brand suffix when combined length exceeds 60", () => {
    const long = "Дуже довгий заголовок сторінки про червоні вечірні сукні великих розмірів";
    const out = buildSeoTitle(long, "MARQ");
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).not.toContain("— MARQ");
  });
});
