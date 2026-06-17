/**
 * Smart String System — операції з рядками.
 *
 * Функції:
 * 1. Slug generation — генерація slug
 * 2. Truncate — обрізання
 * 3. Capitalize — велика літера
 * 4. Camel case — camelCase
 * 5. Snake case — snake_case
 * 6. Kebab case — kebab-case
 */

/**
 * Генерувати slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яіїєґ]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Обрізати рядок.
 */
export function truncate(text: string, maxLength: number, suffix: string = "..."): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Велика перша літера.
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * camelCase.
 */
export function toCamelCase(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9а-яіїєґ]+/g, " ")
    .trim()
    .split(" ")
    .map((word, i) =>
      i === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

/**
 * snake_case.
 */
export function toSnakeCase(text: string): string {
  return text
    .replace(/([a-zа-яіїєґ])([A-ZА-ЯІЇЄҐ])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9а-яіїєґ]+/g, "_")
    .toLowerCase()
    .replace(/^_|_$/g, "");
}

/**
 * kebab-case.
 */
export function toKebabCase(text: string): string {
  return toSnakeCase(text).replace(/_/g, "-");
}

/**
 * Замінити шаблон.
 */
export function template(
  str: string,
  vars: Record<string, string>,
): string {
  let result = str;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}
