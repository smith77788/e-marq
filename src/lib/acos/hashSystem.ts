/**
 * Smart Hash System — хешування даних.
 *
 * Алгоритми:
 * 1. SHA-256 через Web Crypto API (async) — для безпеки
 * 2. MurmurHash3 (pure JS) — для швидкого хешування
 * 3. Utility: maskApiKey, shortHash, verifyIntegrity
 *
 * Сумісно з Cloudflare Workers та браузером (Web Crypto).
 */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function webCryptoHash(algo: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(algo, enc.encode(data));
  return bytesToHex(new Uint8Array(buf));
}

export async function sha256Hash(data: string): Promise<string> {
  return webCryptoHash("SHA-256", data);
}

export async function sha512Hash(data: string): Promise<string> {
  return webCryptoHash("SHA-512", data);
}

export async function sha1(data: string): Promise<string> {
  return webCryptoHash("SHA-1", data);
}

/** MurmurHash3 — швидкий синхронний хеш (не криптографічний). */
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

export async function shortHash(data: string, length: number = 8): Promise<string> {
  return (await sha256Hash(data)).slice(0, length);
}

export async function verifyIntegrity(data: string, expectedHash: string): Promise<boolean> {
  return (await sha256Hash(data)) === expectedHash;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}
