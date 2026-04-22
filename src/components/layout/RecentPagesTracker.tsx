/**
 * Mounted inside the authenticated shell. Listens to location changes and
 * records each visited page into localStorage so the ⌘K palette can show a
 * "Recent" group, like Linear / Notion / Raycast.
 *
 * Pure side effect — renders nothing.
 */
import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { recordRecentPage } from "@/lib/recentPages";

const SEGMENT_LABELS: Record<string, string> = {
  brand: "Бренд",
  admin: "Адмін",
  agents: "Агенти",
  dashboard: "Головна",
  onboarding: "Онбординг",
  profile: "Профіль",
  handbook: "Посібник",
  products: "Товари",
  orders: "Замовлення",
  promotions: "Промокоди",
  catalog: "Колекції",
  email: "Email",
  integrations: "Імпорт",
  billing: "Тариф і баланс",
  "site-builder": "Свій сайт",
  settings: "Налаштування",
  tenants: "Бренди",
  users: "Користувачі",
  plans: "Тарифи",
  commands: "Команди",
  overview: "Огляд",
  "dntrade-health": "DN Trade Health",
  live: "Агенти в ефірі",
  library: "Бібліотека агентів",
  "lead-radar": "Lead Radar",
  "topup-requests": "Заявки на оплату",
};

function deriveLabel(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "Головна";
  // Найзмістовніший — останній «не-id» сегмент
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    const isDynamic = /^[0-9a-f]{8}-/i.test(seg) || /^\d+$/.test(seg);
    if (isDynamic) continue;
    if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
    return seg.replace(/-/g, " ");
  }
  return parts[0];
}

export function RecentPagesTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!pathname) return;
    // Не пишемо динамічні id-сторінки в "recent" — занадто шумно.
    // Окремі сторінки продукту/замовлення вже доступні через основний пошук.
    const lastSeg = pathname.split("/").filter(Boolean).pop() ?? "";
    const isDynamic = /^[0-9a-f]{8}-/i.test(lastSeg) || /^\d+$/.test(lastSeg);
    if (isDynamic) return;
    recordRecentPage(pathname, deriveLabel(pathname));
  }, [pathname]);
  return null;
}
