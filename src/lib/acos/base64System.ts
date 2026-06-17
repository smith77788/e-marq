/**
 * Smart Base64 System — кодування/декодування Base64.
 *
 * Функції:
 * 1. Encode — кодування
 * 2. Decode — декодування
 * 3. URL-safe Base64
 * 4. Data URL
 */

/**
 * Кодувати в Base64.
 */
export function base64Encode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64");
}

/**
 * Декодувати Base64.
 */
export function base64Decode(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}

/**
 * URL-safe Base64 кодування.
 */
export function base64UrlEncode(data: string): string {
  return base64Encode(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * URL-safe Base64 декодування.
 */
export function base64UrlDecode(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  const padded = padding ? base64 + "=".repeat(4 - padding) : base64;
  return base64Decode(padded);
}

/**
 * Створити Data URL.
 */
export function createDataUrl(
  mimeType: string,
  data: string,
): string {
  return `data:${mimeType};base64,${base64Encode(data)}`;
}

/**
 * Парсити Data URL.
 */
export function parseDataUrl(
  dataUrl: string,
): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: base64Decode(match[2]),
  };
}
