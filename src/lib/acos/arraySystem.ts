/**
 * Smart Array System — операції з масивами.
 *
 * Функції:
 * 1. Chunk — розбиття на частини
 * 2. Unique — унікальні елементи
 * 3. GroupBy — групування
 * 4. Sort — сортування
 * 5. Filter — фільтрація
 */

/**
 * Розбити масив на частини.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Унікальні елементи.
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Унікальні за ключем.
 */
export function uniqueByKey<T>(array: T[], key: keyof T): T[] {
  const seen = new Set<unknown>();
  return array.filter((item) => {
    const val = item[key];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

/**
 * Групування за ключем.
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const val = String(item[key]);
    if (!groups[val]) groups[val] = [];
    groups[val].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

/**
 * Сортування за ключем.
 */
export function sortBy<T>(array: T[], key: keyof T, order: "asc" | "desc" = "asc"): T[] {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal < bVal) return order === "asc" ? -1 : 1;
    if (aVal > bVal) return order === "asc" ? 1 : -1;
    return 0;
  });
}

/**
 * Підрахунок за умовою.
 */
export function countBy<T>(array: T[], predicate: (item: T) => boolean): number {
  return array.filter(predicate).length;
}

/**
 * Сума за ключем.
 */
export function sumBy<T>(array: T[], key: keyof T): number {
  return array.reduce((s, item) => s + (Number(item[key]) || 0), 0);
}

/**
 * Середнє за ключем.
 */
export function avgBy<T>(array: T[], key: keyof T): number {
  if (array.length === 0) return 0;
  return sumBy(array, key) / array.length;
}

/**
 * Min/Max за ключем.
 */
export function minBy<T>(array: T[], key: keyof T): T | undefined {
  return array.reduce((min, item) =>
    item[key] < min[key] ? item : min,
  array[0]);
}

export function maxBy<T>(array: T[], key: keyof T): T | undefined {
  return array.reduce((max, item) =>
    item[key] > max[key] ? item : max,
  array[0]);
}
