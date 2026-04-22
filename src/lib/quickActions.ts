/**
 * Quick Actions for ⌘K command palette — like Linear / Raycast.
 *
 * Each action is either:
 *  - a navigation shortcut (run: navigate to a route, optionally with hash),
 *  - or a side-effect action (run: mutate UI, e.g. toggle theme).
 *
 * Actions are static (no server calls) so the palette stays snappy.
 * Visibility is filtered by `requiresSuperAdmin` flag.
 */
import {
  Bot,
  CreditCard,
  LifeBuoy,
  Moon,
  Package,
  Plug,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type QuickActionKind = "nav" | "fx";

export type QuickAction = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  kind: QuickActionKind;
  /** For "nav" actions */
  to?: string;
  hash?: string;
  /** For "fx" actions */
  fx?: "toggle-theme" | "reload" | "sign-out";
  requiresSuperAdmin?: boolean;
  /** Used for matching when user types a query */
  keywords?: string[];
};

export const QUICK_ACTIONS: QuickAction[] = [
  // Owner / brand quick actions
  {
    id: "qa.new-product",
    label: "Створити товар",
    hint: "Перейти до каталогу і додати новий товар",
    icon: Package,
    kind: "nav",
    to: "/brand/products",
    hash: "new",
    keywords: ["new product", "товар", "додати", "create"],
  },
  {
    id: "qa.import-data",
    label: "Імпорт даних",
    hint: "DN Trade, Shopify, CSV — налаштувати імпорт",
    icon: Plug,
    kind: "nav",
    to: "/brand/integrations",
    keywords: ["import", "sync", "dntrade", "shopify"],
  },
  {
    id: "qa.open-orders",
    label: "Відкрити замовлення",
    hint: "Список усіх замовлень бренду",
    icon: ShoppingBag,
    kind: "nav",
    to: "/brand/orders",
    keywords: ["orders", "замовлення", "продажі"],
  },
  {
    id: "qa.open-billing",
    label: "Тариф і баланс",
    hint: "Поповнити баланс або змінити тариф",
    icon: CreditCard,
    kind: "nav",
    to: "/brand/billing",
    keywords: ["billing", "баланс", "оплата", "tariff", "subscription"],
  },
  {
    id: "qa.agents-live",
    label: "Агенти в ефірі",
    hint: "Live-стрічка запусків агентів",
    icon: Bot,
    kind: "nav",
    to: "/agents/live",
    keywords: ["agents", "live", "runs", "запуски"],
  },
  {
    id: "qa.agents-library",
    label: "Бібліотека агентів",
    hint: "Перелік усіх AI-агентів",
    icon: Sparkles,
    kind: "nav",
    to: "/agents/library",
    keywords: ["agents", "library", "бібліотека"],
  },
  {
    id: "qa.handbook",
    label: "Посібник користувача",
    hint: "Як користуватись MARQ",
    icon: LifeBuoy,
    kind: "nav",
    to: "/handbook",
    keywords: ["help", "docs", "посібник", "довідка"],
  },

  // Admin
  {
    id: "qa.admin-health",
    label: "Health-монітор тенантів",
    hint: "Стан інтеграцій по всіх брендах",
    icon: ShieldCheck,
    kind: "nav",
    to: "/admin/health",
    requiresSuperAdmin: true,
    keywords: ["health", "monitor", "admin"],
  },
  {
    id: "qa.admin-tenants",
    label: "Усі бренди",
    hint: "Адмінка — список тенантів",
    icon: ShieldCheck,
    kind: "nav",
    to: "/admin/tenants",
    requiresSuperAdmin: true,
    keywords: ["tenants", "brands", "admin"],
  },

  // Side-effect actions
  {
    id: "qa.toggle-theme",
    label: "Перемкнути тему (світла/темна)",
    hint: "Light ↔ Dark mode",
    icon: Sun,
    kind: "fx",
    fx: "toggle-theme",
    keywords: ["theme", "dark", "light", "тема"],
  },
  {
    id: "qa.reload",
    label: "Оновити сторінку",
    hint: "Перезавантажити поточну сторінку",
    icon: RefreshCcw,
    kind: "fx",
    fx: "reload",
    keywords: ["reload", "refresh", "оновити"],
  },
];

// Helper used by the toggle-theme action — must mirror ThemeToggle.tsx
// (key = "acos.theme", only `.light` class is toggled; dark is :root default).
const THEME_STORAGE_KEY = "acos.theme";
export function toggleThemeMode() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isLight = root.classList.contains("light");
  const next = isLight ? "dark" : "light";
  root.classList.toggle("light", next === "light");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* ignore quota */
  }
  // ThemeToggle keeps its own React state; broadcast a storage event so it
  // re-reads next time it remounts. Live sync is not strictly needed.
}

// Keep Moon import referenced for tree-shaking edge cases when only the icon
// type is used externally.
export const QUICK_ACTION_ICONS = { Moon };
