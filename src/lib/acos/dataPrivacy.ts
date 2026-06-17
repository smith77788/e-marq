/**
 * Smart Data Privacy — керування приватністю даних.
 *
 * Функції:
 * 1. Anonymization — анонімізація PII
 * 2. Pseudonymization — псевдонімізація
 * 3. Data masking — маскування даних
 * 4. Consent tracking — відстеження згод
 */
import { createHash } from "crypto";

/**
 * Анонімізувати email.
 */
export function anonymizeEmail(email: string): string {
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 8);
  return `user-${hash}@anonymized.com`;
}

/**
 * Замаскувати телефон.
 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-2);
}

/**
 * Замаскувати ім'я.
 */
export function maskName(name: string): string {
  if (name.length < 2) return "*";
  return name[0] + "*".repeat(name.length - 1);
}

/**
 * Замаскувати адресу.
 */
export function maskAddress(address: Record<string, unknown>): Record<string, unknown> {
  return {
    city: address.city,
    country: address.country,
    zip: typeof address.zip === "string" ? address.zip.slice(0, 2) + "**" : "**",
  };
}
