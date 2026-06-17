/**
 * Smart Validation System — централізована система валідації даних.
 *
 * Типи:
 * 1. String — рядок
 * 2. Number — число
 * 3. Email — електронна пошта
 * 4. Phone — телефон
 * 5. UUID — унікальний ідентифікатор
 * 6. Date — дата
 * 7. URL — посилання
 */

export type ValidationRule = {
  type: string;
  params?: Record<string, unknown>;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Валідувати значення.
 */
export function validate(
  value: unknown,
  rules: ValidationRule[],
): ValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    const error = validateRule(value, rule);
    if (error) errors.push(error);
  }

  return { valid: errors.length === 0, errors };
}

function validateRule(value: unknown, rule: ValidationRule): string | null {
  switch (rule.type) {
    case "required":
      if (!value || (typeof value === "string" && !value.trim())) {
        return rule.message;
      }
      break;
    case "string":
      if (typeof value !== "string") return rule.message;
      if (rule.params?.minLength && value.length < (rule.params.minLength as number)) {
        return rule.message;
      }
      if (rule.params?.maxLength && value.length > (rule.params.maxLength as number)) {
        return rule.message;
      }
      break;
    case "number":
      if (typeof value !== "number" || isNaN(value)) return rule.message;
      if (rule.params?.min !== undefined && value < (rule.params.min as number)) {
        return rule.message;
      }
      if (rule.params?.max !== undefined && value > (rule.params.max as number)) {
        return rule.message;
      }
      break;
    case "email":
      if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return rule.message;
      }
      break;
    case "phone":
      if (typeof value !== "string" || !/^\+?[0-9]{10,15}$/.test(value.replace(/[\s()-]/g, ""))) {
        return rule.message;
      }
      break;
    case "uuid":
      if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return rule.message;
      }
      break;
    case "url":
      if (typeof value !== "string" || !/^https?:\/\//.test(value)) {
        return rule.message;
      }
      break;
  }

  return null;
}

/**
 * Готові правила валідації.
 */
export const RULES = {
  required: (message = "Поле обов'язкове"): ValidationRule => ({ type: "required", message }),
  minLength: (min: number, message?: string): ValidationRule => ({
    type: "string",
    params: { minLength: min },
    message: message ?? `Мінімум ${min} символів`,
  }),
  maxLength: (max: number, message?: string): ValidationRule => ({
    type: "string",
    params: { maxLength: max },
    message: message ?? `Максимум ${max} символів`,
  }),
  email: (message = "Некоректний email"): ValidationRule => ({ type: "email", message }),
  phone: (message = "Некоректний телефон"): ValidationRule => ({ type: "phone", message }),
  uuid: (message = "Некоректний ID"): ValidationRule => ({ type: "uuid", message }),
  min: (min: number, message?: string): ValidationRule => ({
    type: "number",
    params: { min },
    message: message ?? `Мінімум ${min}`,
  }),
  max: (max: number, message?: string): ValidationRule => ({
    type: "number",
    params: { max },
    message: message ?? `Максимум ${max}`,
  }),
};
