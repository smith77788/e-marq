/**
 * Smart Date System — робота з датами.
 *
 * Функції:
 * 1. Форматування
 * 2. Парсинг
 * 3. Обчислення різниці
 * 4. Генерація періодів
 */

/**
 * Форматувати дату.
 */
export function formatDate(
  date: Date | string,
  format: string = "dd.MM.yyyy",
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  return format
    .replace("dd", day)
    .replace("MM", month)
    .replace("yyyy", String(year))
    .replace("HH", hours)
    .replace("mm", minutes)
    .replace("ss", seconds);
}

/**
 * Парсити дату.
 */
export function parseDate(str: string): Date | null {
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Обчислити різницю в днях.
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === "string" ? new Date(date1) : date1;
  const d2 = typeof date2 === "string" ? new Date(date2) : date2;
  return Math.floor((d2.getTime() - d1.getTime()) / (24 * 3600 * 1000));
}

/**
 * Отримати початок дня.
 */
export function startOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Отримати кінець дня.
 */
export function endOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Додати дні до дати.
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Отримати назву дня тижня.
 */
export function getDayName(date: Date | string, locale: string = "uk-UA"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale, { weekday: "long" });
}

/**
 * Отримати назву місяця.
 */
export function getMonthName(date: Date | string, locale: string = "uk-UA"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale, { month: "long" });
}
