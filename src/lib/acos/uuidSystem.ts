/**
 * Smart UUID System — генерація та валідація UUID.
 * Використовує Web Crypto API (сумісно з Cloudflare Workers та браузером).
 */

export function uuidv4(): string {
  return crypto.randomUUID();
}

export function nanoId(length: number = 21): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

export function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export function generateId(prefix: string = ""): string {
  return prefix ? `${prefix}_${nanoId(16)}` : nanoId(21);
}

export function shortenId(id: string): string {
  return id.replace(/-/g, "").slice(0, 12);
}
