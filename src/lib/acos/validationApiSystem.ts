/**
 * Smart API Validation — валідація API запитів та відповідей.
 *
 * Типи валідації:
 * 1. Request Body — тіло запиту
 * 2. Query Params — параметри запиту
 * 3. Headers — заголовки
 * 4. Path Params — параметри шляху
 */

export type ValidationRule = {
  field: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: unknown[];
};

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Валідувати об'єкт за правилами.
 */
export function validateObject(
  data: Record<string, unknown>,
  rules: ValidationRule[],
): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null)) {
      errors.push({ field: rule.field, message: `${rule.field} обов'язкове` });
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rule.type === "string" && typeof value === "string") {
      if (rule.minLength && value.length < rule.minLength) {
        errors.push({ field: rule.field, message: `Мінімум ${rule.minLength} символів` });
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push({ field: rule.field, message: `Максимум ${rule.maxLength} символів` });
      }
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
        errors.push({ field: rule.field, message: "Некоректний формат" });
      }
    }

    if (rule.type === "number" && typeof value === "number") {
      if (rule.min !== undefined && value < rule.min) {
        errors.push({ field: rule.field, message: `Мінімум ${rule.min}` });
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push({ field: rule.field, message: `Максимум ${rule.max}` });
      }
    }

    if (rule.enum && !rule.enum.includes(value)) {
      errors.push({ field: rule.field, message: `Недопустиме значення` });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Готові правила для замовлень.
 */
export const ORDER_VALIDATION: ValidationRule[] = [
  { field: "customer_email", type: "string", required: true, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
  { field: "customer_name", type: "string", required: true, minLength: 1, maxLength: 200 },
  { field: "total_cents", type: "number", required: true, min: 1 },
  { field: "currency", type: "string", required: true, enum: ["UAH", "USD", "EUR"] },
];

/**
 * Готові правила для товарів.
 */
export const PRODUCT_VALIDATION: ValidationRule[] = [
  { field: "name", type: "string", required: true, minLength: 1, maxLength: 500 },
  { field: "price_cents", type: "number", required: true, min: 0 },
  { field: "stock", type: "number", required: true, min: 0 },
];
