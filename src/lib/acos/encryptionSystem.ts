/**
 * Smart Encryption System — шифрування даних.
 *
 * Методи:
 * 1. AES-256-GCM — симетричне шифрування
 * 2. RSA — асиметричне шифрування
 * 3. Hashing — хешування
 * 4. HMAC — підпис повідомлень
 */
import { createHash, randomBytes, createHmac } from "crypto";

/**
 * Генерувати випадковий ключ.
 */
export function generateKey(length: number = 32): string {
  return randomBytes(length).toString("hex");
}

/**
 * Генерувати випадковий IV.
 */
export function generateIv(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Хешування SHA-256.
 */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Хешування SHA-512.
 */
export function sha512(data: string): string {
  return createHash("sha512").update(data).digest("hex");
}

/**
 * HMAC-SHA256 підпис.
 */
export function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * Перевірити HMAC.
 */
export function verifyHmac(
  data: string,
  secret: string,
  expectedSignature: string,
): boolean {
  const computed = hmacSha256(data, secret);
  return computed === expectedSignature;
}

/**
 * Генерувати API ключ.
 */
export function generateApiKey(prefix: string = "mk"): string {
  const random = randomBytes(24).toString("hex");
  return `${prefix}_${random}`;
}

/**
 * Маскувати API ключ.
 */
export function maskApiKey(key: string): string {
  if (key.length < 10) return "***";
  return key.slice(0, 6) + "..." + key.slice(-4);
}
