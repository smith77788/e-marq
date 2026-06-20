/**
 * Smart Form System — централізована система форм.
 *
 * Типи форм:
 * 1. Contact Form — форма контакту
 * 2. Feedback Form — форма зворотного зв'язку
 * 3. Order Form — форма замовлення
 * 4. Registration Form — форма реєстрації
 *
 * Валідація:
 * 1. Required fields — обов'язкові поля
 * 2. Email validation — валідація email
 * 3. Phone validation — валідація телефону
 * 4. Custom rules — кастомні правила
 */

export type FormField = {
  name: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select" | "checkbox";
  required: boolean;
  placeholder?: string;
  options?: string[];
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    message: string;
  };
};

export type FormConfig = {
  id: string;
  name: string;
  fields: FormField[];
  submitUrl: string;
  successMessage: string;
};

/**
 * Валідувати форму.
 */
export function validateForm(
  fields: FormField[],
  values: Record<string, unknown>,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = values[field.name];

    if (field.required && (!value || (typeof value === "string" && !value.trim()))) {
      errors[field.name] = `${field.label} обов'язкове`;
      continue;
    }

    if (value && field.type === "email" && typeof value === "string") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors[field.name] = "Некоректний email";
      }
    }

    if (value && field.type === "phone" && typeof value === "string") {
      if (!/^\+?[0-9]{10,15}$/.test(value.replace(/[\s()-]/g, ""))) {
        errors[field.name] = "Некоректний телефон";
      }
    }

    if (value && field.validation?.pattern && typeof value === "string") {
      if (!new RegExp(field.validation.pattern).test(value)) {
        errors[field.name] = field.validation.message;
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Створити конфігурацію контактної форми.
 */
export function createContactFormConfig(): FormConfig {
  return {
    id: "contact",
    name: "Зворотний зв'язок",
    fields: [
      { name: "name", label: "Ім'я", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Телефон", type: "phone", required: false },
      { name: "message", label: "Повідомлення", type: "textarea", required: true },
    ],
    submitUrl: "/api/public/contact",
    successMessage: "Дякуємо! Ми зв'яжемося з вами протягом 24 годин.",
  };
}
