/**
 * Smart Data Transformation — перетворення даних між форматами.
 *
 * Формати:
 * 1. CSV ↔ JSON
 * 2. JSON ↔ XML
 * 3. Date formatting
 * 4. Currency conversion
 */
import Papa from "papaparse";

/**
 * CSV → JSON.
 */
export function csvToJson(csv: string): Record<string, string>[] {
  const result = Papa.parse(csv, { header: true, skipEmptyLines: true });
  return result.data as Record<string, string>[];
}

/**
 * JSON → CSV.
 */
export function jsonToCsv(data: Record<string, unknown>[]): string {
  return Papa.unparse(data);
}

/**
 * Форматувати дату.
 */
export function formatDate(date: string | Date, format: string = "dd.MM.yyyy"): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return format
    .replace("dd", day)
    .replace("MM", month)
    .replace("yyyy", String(year))
    .replace("HH", hours)
    .replace("mm", minutes);
}

/**
 * Конвертувати копійки в гривні.
 */
export function centsToUah(cents: number): string {
  return `${(cents / 100).toLocaleString("uk-UA", { minimumFractionDigits: 2 })} ₴`;
}

/**
 * Конвертувати гривні в копійки.
 */
export function uahToCents(uah: number): number {
  return Math.round(uah * 100);
}
