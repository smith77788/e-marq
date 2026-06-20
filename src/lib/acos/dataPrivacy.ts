/**
 * Smart Data Privacy — керування приватністю даних.
 *
 * Функції:
 * 1. Anonymization — анонімізація PII
 * 2. Pseudonymization — псевдонімізація
 * 3. Data masking — маскування даних
 * 4. Consent tracking — відстеження згод
 */
function simpleHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function anonymizeEmail(email: string): string {
  return `user-${simpleHash(email)}@anonymized.com`;
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
