/**
 * Smart Accessibility System — доступність для всіх користувачів.
 *
 * Функції:
 * 1. ARIA labels — мітки для скрінрідерів
 * 2. Keyboard navigation — навігація клавіатурою
 * 3. Color contrast — контрастність кольорів
 * 4. Screen reader support — підтримка скрінрідерів
 */

/**
 * Генерувати ARIA label для кнопки.
 */
export function getAriaLabel(
  action: string,
  context?: string,
): string {
  return context ? `${action} ${context}` : action;
}

/**
 * Генерувати ARIA live region.
 */
export function getAriaLive(
  message: string,
  priority: "polite" | "assertive" = "polite",
): { "aria-live": string; "aria-atomic": string } {
  return {
    "aria-live": priority,
    "aria-atomic": "true",
  };
}

/**
 * Перевірити контрастність кольорів (WCAG AA).
 */
export function checkContrast(
  foreground: string,
  background: string,
): { ratio: number; passesAA: boolean; passesAAA: boolean } {
  // Спрощений розрахунок контрастності
  const fLuminance = getLuminance(foreground);
  const bLuminance = getLuminance(background);
  const ratio = (Math.max(fLuminance, bLuminance) + 0.05) / (Math.min(fLuminance, bLuminance) + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    passesAA: ratio >= 4.5,
    passesAAA: ratio >= 7,
  };
}

function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Генерувати keyboard shortcuts.
 */
export const KEYBOARD_SHORTCUTS = {
  save: { key: "Ctrl+S", description: "Зберегти" },
  cancel: { key: "Escape", description: "Скасувати" },
  search: { key: "Ctrl+K", description: "Пошук" },
  dashboard: { key: "Ctrl+D", description: "Дашборд" },
};
