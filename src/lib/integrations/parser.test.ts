import { autoMap, parseFile, parsePriceToCents, validateImportData } from "./parser";

describe("integration parser helpers", () => {
  it("maps common localized product headers", () => {
    expect(autoMap(["Назва товару", "Ціна", "Залишок"], "products")).toEqual({
      name: "Назва товару",
      price_cents: "Ціна",
      stock: "Залишок",
    });
  });

  it("parses localized money values into cents", () => {
    expect(parsePriceToCents("1 200,50 грн")).toBe(120_050);
    expect(parsePriceToCents("99.99")).toBe(9_999);
    expect(parsePriceToCents("")).toBe(0);
  });

  it("rejects files larger than the supported limit", async () => {
    const oversize = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "catalog.csv", {
      type: "text/csv",
    });

    await expect(parseFile(oversize)).rejects.toThrow("до 10 МБ");
  });

  it("flags invalid mappings and bad money columns", () => {
    const result = validateImportData(
      [
        { name_col: "Футболка", wrong_price: "помилка" },
        { name_col: "Кросівки", wrong_price: "ще одна помилка" },
        { name_col: "Кепка", wrong_price: "не число" },
        { name_col: "Куртка", wrong_price: "текст" },
      ],
      {
        name: "name_col",
        price_cents: "wrong_price",
        sku: "name_col",
      },
      "products",
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("Одна колонка вибрана"))).toBe(true);
    expect(
      result.errors.some((error) => error.includes("Занадто багато нерозпізнаних цін/сум")),
    ).toBe(true);
  });
});
