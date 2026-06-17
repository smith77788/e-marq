/**
 * Smart Map System — операції з Map та Record.
 *
 * Функції:
 * 1. Invert — інвертування
 * 2. MapValues — трансформація значень
 * 3. Filter — фільтрація
 * 4. Merge — злиття
 * 5. Pick/Omit — вибір/виключення
 */

/**
 * Інвертувати Record (keys ↔ values).
 */
export function invertRecord<T extends Record<string, string>>(
  obj: T,
): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));
}

/**
 * Трансформувати значення.
 */
export function mapValues<T, U>(
  obj: Record<string, T>,
  fn: (value: T, key: string) => U,
): Record<string, U> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, fn(value, key)]),
  );
}

/**
 * Фільтрувати Record.
 */
export function filterRecord<T>(
  obj: Record<string, T>,
  predicate: (value: T, key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => predicate(value, key)),
  );
}

/**
 * Злити Records.
 */
export function mergeRecords<T>(
  ...records: Record<string, T>[]
): Record<string, T> {
  return Object.assign({}, ...records);
}

/**
 * Вибрати ключі.
 */
export function pickKeys<T>(
  obj: Record<string, T>,
  keys: string[],
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Виключити ключі.
 */
export function omitKeys<T>(
  obj: Record<string, T>,
  keys: string[],
): Record<string, T> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Порожній Record.
 */
export function isEmpty(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length === 0;
}

/**
 * Кількість ключів.
 */
export function sizeOf(obj: Record<string, unknown>): number {
  return Object.keys(obj).length;
}
