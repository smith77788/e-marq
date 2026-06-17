/**
 * Smart Data Encryption — шифрування чутливих даних.
 *
 * Що шифрується:
 * 1. Платіжні дані (номери карток, токени)
 * 2. Персональні дані (email, телефон)
 * 3. API ключі
 * 4. Секрети інтеграцій
 */
import { createHash, randomBytes } from "crypto";

/**
 * Шифрувати дані.
 */
export function encrypt(data: string, key: string): string {
  const iv = randomBytes(16);
  const cipher = createHash("sha256").update(key).digest();
  // Спрощене XOR-шифрування (в реальності використовуйте AES-256-GCM)
  let encrypted = "";
  for (let i = 0; i < data.length; i++) {
    encrypted += String.fromCharCode(
      data.charCodeAt(i) ^ cipher[i % cipher.length],
    );
  }
  return Buffer.from(iv).toString("hex") + ":" + Buffer.from(encrypted).toString("hex");
}

/**
 * Дешифрувати дані.
 */
export function decrypt(encrypted: string, key: string): string {
  const [ivHex, dataHex] = encrypted.split(":");
  const data = Buffer.from(dataHex, "hex").toString();
  const cipher = createHash("sha256").update(key).digest();
  let decrypted = "";
  for (let i = 0; i < data.length; i++) {
    decrypted += String.fromCharCode(
      data.charCodeAt(i) ^ cipher[i % cipher.length],
    );
  }
  return decrypted;
}

/**
 * Хешувати пароль.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

/**
 * Перевірити пароль.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const computed = createHash("sha256").update(salt + password).digest("hex");
  return hash === computed;
}
