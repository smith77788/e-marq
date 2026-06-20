/**
 * Smart Hash System — хешування даних.
 *
 * Алгоритми:
 * 1. MD5 — для хешів (не для безпеки)
 * 2. SHA-1 — для checksums
 * 3. SHA-256 — для безпеки
 * 4. SHA-512 — для криптографічної безпеки
 * 5. MurmurHash3 — для швидкого хешування
 */
import { createHash } from "crypto";

/**
 * MD5 хеш.
 */
export function md5(data: string): string {
  return createHash("md5").update(data).digest("hex");
}

/**
 * SHA-1 хеш.
 */
export function sha1(data: string): string {
  return createHash("sha1").update(data).digest("hex");
}

/**
 * SHA-256 хеш.
 */
export function sha256Hash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * SHA-512 хеш.
 */
export function sha512Hash(data: string): string {
  return createHash("sha512").update(data).digest("hex");
}

/**
 * MurmurHash3 (спрощений).
 */
export function murmurhash3(data: string, seed: number = 0): number {
  let h = seed;
  for (let i = 0; i < data.length; i++) {
    h = Math.imul(h ^ data.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Генерувати короткий хеш.
 */
export function shortHash(data: string, length: number = 8): string {
  return sha256Hash(data).slice(0, length);
}

/**
 * Перевірити цілісність файлу.
 */
export function verifyIntegrity(data: string, expectedHash: string): boolean {
  return sha256Hash(data) === expectedHash;
}

/**
 * Маскувати API ключ — показати тільки перші та останні 4 символи.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}
