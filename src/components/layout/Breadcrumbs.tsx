/**
 * Простий шлях навігації, який рендериться у header authenticated-shell.
 * Будує крихти на основі першого матчу router-а та статичної мапи розділів.
 * Тонкий і малопомітний — ставимо акцент на іконку розділу + дрібний текст.
 */
import { useLocation } from "@tanstack/react-router";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

type Crumb = { label: string; to?: string };

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
  billing: "Тариф",
  "site-builder": "Свій сайт",
  settings: "Налаштування",
  tenants: "Бренди",
  users: "Користувачі",
  plans: "Тарифи",
  commands: "Команди",
  overview: "Огляд",
  "dntrade-health": "DN Trade",
  live: "В ефірі",
  invite: "Запрошення",
};

function humanize(seg: string) {
  return SEGMENT_LABELS[seg] ?? seg.replace(/-/g, " ");
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) return null;

  const crumbs: Crumb[] = [];
  let acc = "";
  parts.forEach((p, i) => {
    acc += "/" + p;
    // не додаємо динамічні id як окремий клікабельний crumb
    const isDynamic = /^[0-9a-f]{8}-/i.test(p) || /^\d+$/.test(p);
    crumbs.push({
      label: isDynamic ? p.slice(0, 8) + "…" : humanize(p),
      to: i === parts.length - 1 ? undefined : acc,
    });
  });

  return (
    <nav
      aria-label="Хлібні крихти"
      className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground md:flex"
    >
      <a
        href="/dashboard"
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        aria-label="Головна"
      >
        <Home className="h-3.5 w-3.5" />
      </a>
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
          {c.to ? (
            <a
              href={c.to}
              className={cn(
                "truncate transition-colors hover:text-foreground",
                "max-w-[160px]",
              )}
            >
              {c.label}
            </a>
          ) : (
            <span className="truncate font-medium text-foreground max-w-[200px]">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
