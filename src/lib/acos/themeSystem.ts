/**
 * Smart Theme System — теми оформлення.
 *
 * Теми:
 * 1. Light — світла
 * 2. Dark — темна
 * 3. Auto — автоматична
 * 4. Custom — кастомна
 */

export type Theme = "light" | "dark" | "auto";

export type ThemeColors = {
  background: string;
  foreground: string;
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  destructive: string;
};

const THEME_COLORS: Record<Theme, ThemeColors> = {
  light: {
    background: "#ffffff",
    foreground: "#0f172a",
    primary: "#6366f1",
    secondary: "#f1f5f9",
    accent: "#f1f5f9",
    muted: "#f1f5f9",
    destructive: "#ef4444",
  },
  dark: {
    background: "#0f172a",
    foreground: "#f8fafc",
    primary: "#818cf8",
    secondary: "#1e293b",
    accent: "#1e293b",
    muted: "#1e293b",
    destructive: "#f87171",
  },
  auto: {
    background: "#ffffff",
    foreground: "#0f172a",
    primary: "#6366f1",
    secondary: "#f1f5f9",
    accent: "#f1f5f9",
    muted: "#f1f5f9",
    destructive: "#ef4444",
  },
};

let currentTheme: Theme = "auto";

/**
 * Встановити тему.
 */
export function setTheme(theme: Theme): void {
  currentTheme = theme;
  if (typeof window !== "undefined") {
    localStorage.setItem("marq-theme", theme);
    applyTheme(theme);
  }
}

/**
 * Отримати поточну тему.
 */
export function getTheme(): Theme {
  if (typeof window !== "undefined") {
    return (localStorage.getItem("marq-theme") as Theme) || "auto";
  }
  return currentTheme;
}

/**
 * Застосувати тему.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "auto") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.add(prefersDark ? "dark" : "light");
  } else {
    root.classList.add(theme);
  }
}

/**
 * Отримати кольори теми.
 */
export function getThemeColors(theme?: Theme): ThemeColors {
  const t = theme ?? currentTheme;
  return THEME_COLORS[t] ?? THEME_COLORS.auto;
}

/**
 * Ініціалізувати тему при завантаженні.
 */
export function initTheme(): void {
  const theme = getTheme();
  applyTheme(theme);
}
