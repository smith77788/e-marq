/**
 * Smart Serialization System — серіалізація/десеріалізація даних.
 *
 * Формати:
 * 1. JSON
 * 2. CSV
 * 3. XML (спрощений)
 * 4. URL-encoded
 */
import Papa from "papaparse";

/**
 * JSON серіалізація.
 */
export function serializeJson(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * JSON десеріалізація.
 */
export function deserializeJson<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * CSV серіалізація.
 */
export function serializeCsv(data: Record<string, unknown>[]): string {
  return Papa.unparse(data);
}

/**
 * CSV десеріалізація.
 */
export function deserializeCsv(str: string): Record<string, string>[] {
  const result = Papa.parse(str, { header: true, skipEmptyLines: true });
  return result.data as Record<string, string>[];
}

/**
 * URL-encoded серіалізація.
 */
export function serializeUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/**
 * URL-encoded десеріалізація.
 */
export function deserializeUrlEncoded(str: string): Record<string, string> {
  return Object.fromEntries(
    str.split("&").map((pair) => {
      const [key, value] = pair.split("=");
      return [decodeURIComponent(key), decodeURIComponent(value ?? "")];
    }),
  );
}
