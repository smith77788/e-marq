/**
 * Smart Object System — операції з об'єктами.
 *
 * Функції:
 * 1. Deep merge — глибоке злиття
 * 2. Pick/omit — вибір/виключення полів
 * 3. Flatten/Unflatten — згортання/розгортання
 * 4. Clone — клонування
 */

/**
 * Глибоке злиття об'єктів.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(
        (result[key] ?? {}) as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      ) as T[Extract<keyof T, string>];
    } else {
      result[key] = source[key] as T[Extract<keyof T, string>];
    }
  }
  return result;
}

/**
 * Вибрати поля.
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Виключити поля.
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Згортання вкладених об'єктів.
 */
export function flatten(
  obj: Record<string, unknown>,
  prefix: string = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(result, flatten(obj[key] as Record<string, unknown>, newKey));
    } else {
      result[newKey] = obj[key];
    }
  }
  return result;
}

/**
 * Розгортання плоского об'єкта.
 */
export function unflatten(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const parts = key.split(".");
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = obj[key];
  }
  return result;
}

/**
 * Глибоке клонування.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
