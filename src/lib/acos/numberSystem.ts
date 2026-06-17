/**
 * Smart Number System — операції з числами.
 *
 * Функції:
 * 1. Форматування валют
 * 2. Округлення
 * 3. Відсотки
 * 4. Статистика
 */

/**
 * Форматувати як валюту.
 */
export function formatCurrency(
  amount: number,
  currency: string = "UAH",
  locale: string = "uk-UA",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Форматувати число з розділювачами тисяч.
 */
export function formatNumber(
  num: number,
  locale: string = "uk-UA",
): string {
  return new Intl.NumberFormat(locale).format(num);
}

/**
 * Округлити до 2 знаків після коми.
 */
export function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}

/**
 * Обчислити відсоток.
 */
export function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100 * 10) / 10 : 0;
}

/**
 * Обчислити знижку.
 */
export function discount(
  originalPrice: number,
  discountPercent: number,
): number {
  return originalPrice * (1 - discountPercent / 100);
}

/**
 * Обчислити націнку.
 */
export function markup(
  cost: number,
  markupPercent: number,
): number {
  return cost * (1 + markupPercent / 100);
}

/**
 * Конвертувати копійки в гривні.
 */
export function centsToHryvnias(cents: number): string {
  return `${(cents / 100).toLocaleString("uk-UA", { minimumFractionDigits: 2 })} ₴`;
}

/**
 * Конвертувати гривні в копійки.
 */
export function hryvniasToCents(hryvnias: number): number {
  return Math.round(hryvnias * 100);
}

/**
 * Середнє значення.
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Медіана.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
