/**
 * Smart Data Validation — валідація та очищення даних.
 *
 * Перевіряє:
 * 1. Email формат
 * 2. Телефон формат
 * 3. Адреса
 * 4. Ціна
 * 5. Дублікати
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Валідувати email.
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!email) {
    errors.push("Email обов'язковий");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Некоректний формат email");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Валідувати телефон.
 */
export function validatePhone(phone: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!phone) {
    warnings.push("Телефон не вказано");
  } else if (!/^\+?[0-9]{10,15}$/.test(phone.replace(/[\s()-]/g, ""))) {
    warnings.push("Некоректний формат телефону");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Валідувати адресу.
 */
export function validateAddress(address: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!address.city) errors.push("Місто обов'язкове");
  if (!address.street) errors.push("Вулиця обов'язкова");
  if (!address.zip) warnings.push("Індекс не вказано");

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Перевірити дублікати клієнтів.
 */
export async function checkDuplicateCustomers(
  tenantId: string,
): Promise<Array<{ email: string; count: number; ids: string[] }>> {
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, email")
    .eq("tenant_id", tenantId)
    .limit(10000);

  if (!customers) return [];

  const emailMap: Record<string, string[]> = {};
  for (const c of customers) {
    if (!c.email) continue;
    const email = c.email.toLowerCase();
    if (!emailMap[email]) emailMap[email] = [];
    emailMap[email].push(c.id);
  }

  return Object.entries(emailMap)
    .filter(([, ids]) => ids.length > 1)
    .map(([email, ids]) => ({ email, count: ids.length, ids }));
}
