/**
 * Smart i18n System — централізована система перекладів.
 *
 * Мови:
 * 1. UA — українська (за замовчуванням)
 * 2. EN — англійська
 * 3. RU — російська
 *
 * Функції:
 * 1. Переклад текстів
 * 2. Форматування дат/чисел
 * 3. Підтримка плuralization
 */

export type Locale = "ua" | "en" | "ru";

const translations: Record<Locale, Record<string, string>> = {
  ua: {
    "common.save": "Зберегти",
    "common.cancel": "Скасувати",
    "common.delete": "Видалити",
    "common.edit": "Редагувати",
    "common.search": "Пошук",
    "common.loading": "Завантаження...",
    "common.error": "Помилка",
    "common.success": "Успішно",
    "dashboard.title": "Дашборд",
    "dashboard.revenue": "Виручка",
    "dashboard.customers": "Клієнти",
    "dashboard.orders": "Замовлення",
    "email.subject": "Тема",
    "email.body": "Текст листа",
    "sms.message": "Текст SMS",
  },
  en: {
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.search": "Search",
    "common.loading": "Loading...",
    "common.error": "Error",
    "common.success": "Success",
    "dashboard.title": "Dashboard",
    "dashboard.revenue": "Revenue",
    "dashboard.customers": "Customers",
    "dashboard.orders": "Orders",
    "email.subject": "Subject",
    "email.body": "Email body",
    "sms.message": "SMS message",
  },
  ru: {
    "common.save": "Сохранить",
    "common.cancel": "Отмена",
    "common.delete": "Удалить",
    "common.edit": "Редактировать",
    "common.search": "Поиск",
    "common.loading": "Загрузка...",
    "common.error": "Ошибка",
    "common.success": "Успешно",
    "dashboard.title": "Панель управления",
    "dashboard.revenue": "Выручка",
    "dashboard.customers": "Клиенты",
    "dashboard.orders": "Заказы",
    "email.subject": "Тема",
    "email.body": "Текст письма",
    "sms.message": "Текст SMS",
  },
};

let currentLocale: Locale = "ua";

/**
 * Встановити мову.
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * Отримати поточну мову.
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Перекласти ключ.
 */
export function t(key: string, params?: Record<string, string>): string {
  let text = translations[currentLocale]?.[key] ?? translations.ua[key] ?? key;

  if (params) {
    for (const [param, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${param}\\}`, "g"), value);
    }
  }

  return text;
}

/**
 * Форматувати число згідно мови.
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat(currentLocale === "ua" ? "uk-UA" : currentLocale).format(num);
}

/**
 * Форматувати валюту.
 */
export function formatCurrency(amount: number, currency: string = "UAH"): string {
  return new Intl.NumberFormat(currentLocale === "ua" ? "uk-UA" : currentLocale, {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Форматувати дату.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(currentLocale === "ua" ? "uk-UA" : currentLocale);
}
