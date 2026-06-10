/**
 * Парсер CSV / Excel файлів з автодетекцією колонок.
 *
 * - CSV: papaparse (підтримує auto-detect роздільника, кодування cp1251 для 1С/BAS).
 * - XLSX: SheetJS (xlsx).
 * - Автомапінг: ми знаємо синоніми ("Назва", "Name", "Title", "Найменування" → name).
 */
import Papa from "papaparse";

export type EntityKind = "products" | "customers" | "orders";

export type ParsedRow = Record<string, string | number | null>;

export type ParseResult = {
  headers: string[];
  rows: ParsedRow[];
  totalRows: number;
};

export type ImportValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalRows: number;
    validRows: number;
    mappedRequired: number;
    requiredFields: number;
  };
};

const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Канонічні поля цільових сутностей. */
export const CANONICAL_FIELDS: Record<
  EntityKind,
  { id: string; label: string; required?: boolean }[]
> = {
  products: [
    { id: "name", label: "Назва товару", required: true },
    { id: "sku", label: "Артикул / SKU" },
    { id: "price_cents", label: "Ціна (UAH)", required: true },
    { id: "stock", label: "Залишок на складі" },
    { id: "description", label: "Опис" },
    { id: "image_url", label: "Посилання на фото" },
    { id: "currency", label: "Валюта (UAH/USD/EUR)" },
  ],
  customers: [
    { id: "name", label: "Імʼя клієнта", required: true },
    { id: "email", label: "Email" },
    { id: "phone", label: "Телефон" },
    { id: "telegram_username", label: "Telegram (@username)" },
  ],
  orders: [
    { id: "customer_name", label: "Імʼя клієнта", required: true },
    { id: "customer_email", label: "Email клієнта" },
    { id: "total_cents", label: "Сума замовлення (UAH)", required: true },
    { id: "currency", label: "Валюта" },
    { id: "status", label: "Статус (paid/pending)" },
    { id: "payment_method", label: "Спосіб оплати" },
    { id: "external_id", label: "Зовнішній номер замовлення" },
  ],
};

/** Українські + англійські + російські синоніми → канонічне поле. */
const SYNONYMS: Record<EntityKind, Record<string, string[]>> = {
  products: {
    name: ["назва", "наименование", "name", "title", "товар", "product", "найменування"],
    sku: ["артикул", "sku", "код", "code", "штрихкод", "barcode"],
    price_cents: ["ціна", "цена", "price", "вартість", "сума", "cost", "amount"],
    stock: ["залишок", "остаток", "stock", "qty", "кількість", "количество", "balance", "склад"],
    description: ["опис", "описание", "description", "details", "подробиці"],
    image_url: ["фото", "image", "picture", "photo", "image_url", "img"],
    currency: ["валюта", "currency", "ccy"],
  },
  customers: {
    name: ["імʼя", "имя", "name", "клієнт", "клиент", "customer", "повне імʼя", "full name"],
    email: ["email", "пошта", "почта", "e-mail", "mail"],
    phone: ["телефон", "phone", "tel", "номер", "mobile"],
    telegram_username: ["telegram", "тг", "tg", "телеграм"],
  },
  orders: {
    customer_name: ["клієнт", "клиент", "покупець", "customer", "name", "імʼя клієнта"],
    customer_email: ["email", "пошта", "e-mail"],
    total_cents: ["сума", "сумма", "total", "amount", "вартість", "разом"],
    currency: ["валюта", "currency"],
    status: ["статус", "status", "стан"],
    payment_method: ["оплата", "payment", "payment_method", "спосіб оплати"],
    external_id: ["номер", "number", "order_id", "id", "external_id", "номер замовлення"],
  },
};

export async function parseFile(file: File): Promise<ParseResult> {
  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new Error("Файл завеликий. Підтримується імпорт файлів до 10 МБ.");
  }
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") return parseXlsx(file);
  return parseCsv(file);
}

async function parseCsv(file: File): Promise<ParseResult> {
  // Спроба cp1251 для українських 1С/BAS файлів — якщо не вдається, fallback на UTF-8.
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    // Якщо знайшли «�» — спробуємо cp1251
    if (text.includes("\uFFFD")) {
      text = new TextDecoder("windows-1251").decode(buf);
    }
  } catch {
    text = new TextDecoder("windows-1251").decode(buf);
  }

  return new Promise<ParseResult>((resolve, reject) => {
    Papa.parse<ParsedRow>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimiter: "", // auto-detect
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const rows = (res.data ?? []).filter((r) =>
          Object.values(r).some((v) => v != null && v !== ""),
        );
        resolve({ headers, rows, totalRows: rows.length });
      },
      error: (err: Error) => reject(err),
    });
  });
}

async function parseXlsx(file: File): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { headers: [], rows: [], totalRows: 0 };
  const sheet = wb.Sheets[firstSheet];
  const json = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: "", raw: false });
  const headers = json.length > 0 ? Object.keys(json[0]) : [];
  return { headers, rows: json, totalRows: json.length };
}

/** Автомапінг: для кожної канонічної колонки знайти найкращу колонку файлу. */
export function autoMap(headers: string[], entityKind: EntityKind): Record<string, string> {
  const result: Record<string, string> = {};
  const dict = SYNONYMS[entityKind];
  for (const [canonical, synonyms] of Object.entries(dict)) {
    const found = headers.find((h) => {
      const norm = h.toLowerCase().trim();
      return synonyms.some((s) => norm.includes(s.toLowerCase()));
    });
    if (found) result[canonical] = found;
  }
  return result;
}

export function validateImportData(
  rows: Array<Record<string, unknown>>,
  mapping: Record<string, string>,
  entityKind: EntityKind,
): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const required = CANONICAL_FIELDS[entityKind].filter((field) => field.required);
  const mappedRequired = required.filter((field) => mapping[field.id]).length;

  const usedColumns = Object.values(mapping).filter(Boolean);
  const duplicatedColumns = usedColumns.filter((col, index) => usedColumns.indexOf(col) !== index);
  if (duplicatedColumns.length > 0) {
    errors.push(
      `Одна колонка вибрана для кількох полів: ${[...new Set(duplicatedColumns)].join(", ")}.`,
    );
  }

  for (const field of required) {
    if (!mapping[field.id]) errors.push(`Не вибрано обовʼязкове поле: ${field.label}.`);
  }

  let validRows = 0;
  let emptyRequiredRows = 0;
  let invalidMoneyRows = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hasAllRequired = required.every((field) => {
      const col = mapping[field.id];
      return col && String(row[col] ?? "").trim().length > 0;
    });
    if (!hasAllRequired) {
      emptyRequiredRows++;
      if (emptyRequiredRows <= 5) errors.push(`Рядок ${i + 2}: порожнє обовʼязкове поле.`);
      continue;
    }

    const moneyField =
      entityKind === "orders" ? "total_cents" : entityKind === "products" ? "price_cents" : null;
    if (moneyField) {
      const col = mapping[moneyField];
      const raw = col ? row[col] : null;
      const cents = parsePriceToCents(raw);
      const rawText = String(raw ?? "").trim();
      if (rawText && cents <= 0 && !/^0+([.,]0+)?$/.test(rawText.replace(/\s/g, "")))
        invalidMoneyRows++;
      if (cents > 100_000_000) warnings.push(`Рядок ${i + 2}: незвично велика сума ${rawText}.`);
    }
    validRows++;
  }

  if (rows.length > 0 && validRows === 0) {
    errors.push(
      "Жоден рядок не проходить перевірку. Ймовірно, вибрано не ті колонки або тип даних.",
    );
  }
  if (invalidMoneyRows > Math.max(3, rows.length * 0.25)) {
    errors.push(
      "Занадто багато нерозпізнаних цін/сум. Перевірте, що поле ціни не вказує на кількість або текстову колонку.",
    );
  } else if (invalidMoneyRows > 0) {
    warnings.push(`Є рядки з нерозпізнаною ціною/сумою: ${invalidMoneyRows}.`);
  }

  return {
    valid: errors.length === 0,
    errors: errors.slice(0, 12),
    warnings: warnings.slice(0, 12),
    stats: { totalRows: rows.length, validRows, mappedRequired, requiredFields: required.length },
  };
}

/** Перетворити рядок у вартість в копійках (підтримує "12,50", "12.50 UAH", "1 200,00"). */
export function parsePriceToCents(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const s = String(raw)
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "");
  const normalized =
    s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
