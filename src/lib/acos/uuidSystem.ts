/**
 * Smart UUID System — генерація та валідація UUID.
 *
 * Типи:
 * 1. UUID v4 — випадковий
 * 2. UUID v5 — на основі namespace + name
 * 3. Nano ID — короткий випадковий ID
 */
import { randomBytes, createHash } from "crypto";

/**
 * Генерувати UUID v4.
 */
export function uuidv4(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  return [
    bytes.toString("hex").slice(0, 8),
    bytes.toString("hex").slice(8, 12),
    bytes.toString("hex").slice(12, 16),
    bytes.toString("hex").slice(16, 20),
    bytes.toString("hex").slice(20, 32),
  ].join("-");
}

/**
 * Генерувати UUID v5 (на основі namespace + name).
 */
export function uuidv5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(namespace + name)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 1
  return [
    hash.toString("hex").slice(0, 8),
    hash.toString("hex").slice(8, 12),
    hash.toString("hex").slice(12, 16),
    hash.toString("hex").slice(16, 20),
    hash.toString("hex").slice(20, 32),
  ].join("-");
}

/**
 * Генерувати Nano ID.
 */
export function nanoId(length: number = 21): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

/**
 * Перевірити UUID.
 */
export function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Скоротити UUID (для відображення).
 */
export function shortUuid(uuid: string): string {
  return uuid.slice(0, 8);
}
