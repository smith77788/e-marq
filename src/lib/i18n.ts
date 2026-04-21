/**
 * Тонкий bilingual layer: UA (за замовчуванням) + EN.
 * Зберігаємо вибір у localStorage, без зовнішніх залежностей.
 */
import { useSyncExternalStore } from "react";

export type Lang = "ua" | "en";
const STORAGE_KEY = "acos.lang";

const dict = {
  ua: {
    // Header / nav
    "nav.brand": "Мій бренд",
    "nav.dashboard": "Панель",
    "nav.tenants": "Бренди (Admin)",
    "nav.signout": "Вийти",
    "nav.lang": "Мова",

    // Sidebar — owner
    "sb.cockpit": "Кокпіт",
    "sb.overview": "Огляд",
    "sb.revenue": "Виторг",
    "sb.growth": "Зростання",
    "sb.insights": "Інсайти",
    "sb.customers": "Клієнти",
    "sb.agents": "Агенти",
    "sb.setup": "Налаштування",
    "sb.channels": "Канали",
    "sb.onboarding": "Онбординг",
    "sb.storefront": "Вітрина",
    "sb.settings": "Параметри",

    // Sidebar — super-admin
    "sb.system": "Система",
    "sb.missionControl": "Командний центр",
    "sb.allTenants": "Усі бренди",
    "sb.liveRuns": "Запуски в ефірі",
    "sb.agentLibrary": "Бібліотека агентів",
    "sb.insightStream": "Потік інсайтів",
    "sb.brandLabel": "Бренд",

    // Header
    "hdr.booting": "Запуск кокпіта…",
    "hdr.superAdmin": "Супер-адмін",

    // Cockpit Hero
    "hero.revenue30": "Виторг · 30д",
    "hero.thisWeek": "цього тижня",
    "hero.aiAttributed": "Створено ШІ",
    "hero.ofRevenue": "виторгу",
    "hero.7d": "за 7д",
    "hero.autonomous": "АВТОНОМНО",
    "hero.conversion7": "Конверсія · 7д",
    "hero.converted": "повідомлень конвертовано з",
    "hero.customers": "Клієнти",
    "hero.active": "активні · стан агентів",

    // Brand page sections
    "brand.missionSubtitle": "Кокпіт місії · що зробив автономний флот, кого знає, скільки заробив.",
    "brand.live": "В ЕФІРІ",
    "brand.revenuePerf": "Виторг та продуктивність",
    "brand.autonomousFleet": "Автономний флот",
    "brand.customersChannels": "Клієнти та канали",
    "brand.noBrandTitle": "Бренд ще не створено",
    "brand.noBrandDesc": "У вас поки немає бренду. Попросіть супер-адміна створити його та призначити вас власником.",
    "brand.loadingBrand": "Завантаження бренду…",

    // Mission Control (admin)
    "mc.title": "Командний центр",
    "mc.subtitle": "Глобальний нагляд за всіма брендами, агентами та виторгом у реальному часі.",
    "mc.gmv30": "GMV · 30д",
    "mc.activeTenants": "Активні бренди",
    "mc.pendingActions": "Дії на схвалення",
    "mc.agentHealth": "Здоров'я агентів",
    "mc.insights24h": "Інсайти · 24г",
    "mc.totalCustomers": "Загалом клієнтів",
    "mc.runs24h": "Запуски агентів · 24г",
    "mc.crossTenantPulse": "Пульс по всіх брендах",
    "mc.leaderboard": "Лідерборд брендів",
    "mc.systemHealth": "Стан системи",
    "mc.viewAll": "Переглянути все",

    // Insights panel
    "insights.title": "Що ШІ знайшов для тебе",
    "insights.desc": "Автоматичні висновки агентів. Один клік — і дія застосована.",
    "insights.empty.title": "Все під контролем",
    "insights.empty.desc": "Нових інсайтів немає. Агенти працюють за розкладом.",
    "insights.apply": "Застосувати",
    "insights.dismiss": "Сховати",
    "insights.confidence": "впевненість",
    "insights.why": "Чому це важливо",
    "insights.what": "Що зробити",
    "insights.tech": "Технічні деталі",

    // Real-time toasts
    "toast.newInsight": "Новий інсайт",
    "toast.actionApplied": "Дію застосовано",
    "toast.agentCompleted": "Агент завершив роботу",

    // Onboarding wizard (existing keys preserved)
    "onb.title": "Швидкий старт за 7 кроків",
    "onb.subtitle": "Налаштуй свій автономний Revenue OS. Можна повернутись і дозаповнити пізніше.",
    "onb.step": "Крок",
    "onb.of": "з",
    "onb.next": "Далі",
    "onb.back": "Назад",
    "onb.skip": "Пропустити",
    "onb.finish": "Завершити та відкрити панель",
    "onb.completed": "Готово ✓",
    "onb.tip": "Підказка",
    "onb.s1.title": "Назва бренду",
    "onb.s1.desc": "Так твій бренд бачитимуть покупці у вітрині та повідомленнях бота.",
    "onb.s1.placeholder": "Напр. Coffee Lab",
    "onb.s2.title": "Канал зв'язку (Telegram)",
    "onb.s2.desc": "Бот спілкується з покупцями та відправляє нагадування. Створи бота через @BotFather, скопіюй токен — ми збережемо його шифровано.",
    "onb.s2.tokenLabel": "Bot token (опційно зараз — можна додати пізніше)",
    "onb.s2.help": "Як створити: 1) відкрий @BotFather у Telegram, 2) /newbot, 3) скопіюй токен сюди.",
    "onb.s3.title": "Перший продукт",
    "onb.s3.desc": "Хоча б один товар, щоб бот міг щось пропонувати. Деталі можна редагувати пізніше.",
    "onb.s3.namePh": "Напр. Espresso Blend 250g",
    "onb.s3.pricePh": "Ціна (USD)",
    "onb.s3.stockPh": "Залишок на складі",
    "onb.s4.title": "Імпорт клієнтів",
    "onb.s4.desc": "Завантаж CSV (email, name) — або скористайся демо-сидом, якщо тільки тестуєш.",
    "onb.s4.csv": "Завантажити CSV",
    "onb.s4.demo": "Засіяти демо-клієнтів",
    "onb.s4.csvHint": "Формат: перший рядок — заголовок 'email,name'.",
    "onb.s5.title": "Tracking-сніпет на сайт",
    "onb.s5.desc": "Встав цей рядок на свій сайт перед </body>. Ми починаємо бачити перегляди, кошики, покупки — без цього агенти працюватимуть тільки на історичних даних.",
    "onb.s5.copy": "Скопіювати сніпет",
    "onb.s5.copied": "Скопійовано ✓",
    "onb.s6.title": "Метод оплати",
    "onb.s6.desc": "Як покупці платитимуть. Поки можна обрати ручну оплату — пізніше підключимо Stripe.",
    "onb.s6.manual": "Ручна оплата (банк / готівка)",
    "onb.s6.stripe": "Stripe (підключимо пізніше)",
    "onb.s7.title": "Запросити команду",
    "onb.s7.desc": "Email колег, які допомагатимуть з брендом. Ми надішлемо їм запрошення (можна пропустити).",
    "onb.s7.emailPh": "colleague@example.com",
    "onb.s7.add": "Додати",
    "onb.s7.invited": "Запрошено",

    // Setup checklist
    "checklist.title": "Чек-лист налаштування",
    "checklist.desc": "Усі налаштування для запуску автономного Revenue OS на одному екрані.",
    "checklist.continue": "Продовжити налаштування",
    "checklist.allDone": "Усе готово — ШІ-агенти працюють у фоні 🚀",
    "checklist.s1": "Бренд створений",
    "checklist.s2": "Telegram-канал підключений",
    "checklist.s3": "Хоча б 1 товар у каталозі",
    "checklist.s4": "Імпортовано клієнтів",
    "checklist.s5": "Tracking-сніпет встановлений",
    "checklist.s6": "Метод оплати обраний",
    "checklist.s7": "Команда запрошена",

    // Generic
    "common.optional": "(опційно)",
    "common.loading": "Завантаження…",
    "common.save": "Зберегти",
    "common.cancel": "Скасувати",
  },
  en: {
    "nav.brand": "My brand",
    "nav.dashboard": "Dashboard",
    "nav.tenants": "Tenants (Admin)",
    "nav.signout": "Sign out",
    "nav.lang": "Language",

    "sb.cockpit": "Cockpit",
    "sb.overview": "Overview",
    "sb.revenue": "Revenue",
    "sb.growth": "Growth",
    "sb.insights": "Insights",
    "sb.customers": "Customers",
    "sb.agents": "Agents",
    "sb.setup": "Setup",
    "sb.channels": "Channels",
    "sb.onboarding": "Onboarding",
    "sb.storefront": "Storefront",
    "sb.settings": "Settings",
    "sb.system": "System",
    "sb.missionControl": "Mission Control",
    "sb.allTenants": "All tenants",
    "sb.liveRuns": "Live runs",
    "sb.agentLibrary": "Agent library",
    "sb.insightStream": "Insight stream",
    "sb.brandLabel": "Brand",

    "hdr.booting": "Booting cockpit…",
    "hdr.superAdmin": "Super-admin",

    "hero.revenue30": "Revenue · 30d",
    "hero.thisWeek": "this week",
    "hero.aiAttributed": "AI-attributed",
    "hero.ofRevenue": "of revenue",
    "hero.7d": "7d",
    "hero.autonomous": "AUTONOMOUS",
    "hero.conversion7": "Conversion · 7d",
    "hero.converted": "messages converted of",
    "hero.customers": "Customers",
    "hero.active": "active · agent health",

    "brand.missionSubtitle": "Mission cockpit · what the autonomous fleet did, who it knows, what it earned.",
    "brand.live": "LIVE",
    "brand.revenuePerf": "Revenue performance",
    "brand.autonomousFleet": "Autonomous fleet",
    "brand.customersChannels": "Customers & channels",
    "brand.noBrandTitle": "No brand yet",
    "brand.noBrandDesc": "You don't own a brand yet. Ask a super-admin to create one and assign you as owner.",
    "brand.loadingBrand": "Loading brand…",

    "mc.title": "Mission Control",
    "mc.subtitle": "Global oversight of every brand, agent and revenue stream — in real time.",
    "mc.gmv30": "GMV · 30d",
    "mc.activeTenants": "Active tenants",
    "mc.pendingActions": "Pending actions",
    "mc.agentHealth": "Agent health",
    "mc.insights24h": "Insights · 24h",
    "mc.totalCustomers": "Total customers",
    "mc.runs24h": "Agent runs · 24h",
    "mc.crossTenantPulse": "Cross-tenant pulse",
    "mc.leaderboard": "Tenant leaderboard",
    "mc.systemHealth": "System health",
    "mc.viewAll": "View all",

    "insights.title": "What the AI found for you",
    "insights.desc": "Auto-generated findings from your agents. One click to act.",
    "insights.empty.title": "All clear",
    "insights.empty.desc": "No new insights. Agents run on schedule.",
    "insights.apply": "Apply",
    "insights.dismiss": "Dismiss",
    "insights.confidence": "confident",
    "insights.why": "Why it matters",
    "insights.what": "What to do",
    "insights.tech": "Technical details",

    "toast.newInsight": "New insight",
    "toast.actionApplied": "Action applied",
    "toast.agentCompleted": "Agent completed",

    "onb.title": "7-step quick start",
    "onb.subtitle": "Set up your autonomous Revenue OS. You can come back to finish anytime.",
    "onb.step": "Step",
    "onb.of": "of",
    "onb.next": "Next",
    "onb.back": "Back",
    "onb.skip": "Skip",
    "onb.finish": "Finish & open dashboard",
    "onb.completed": "Done ✓",
    "onb.tip": "Tip",
    "onb.s1.title": "Brand name",
    "onb.s1.desc": "How customers see your brand in the storefront and bot messages.",
    "onb.s1.placeholder": "e.g. Coffee Lab",
    "onb.s2.title": "Channel (Telegram)",
    "onb.s2.desc": "Your bot talks to customers and sends nudges. Create one via @BotFather, paste the token — we store it encrypted.",
    "onb.s2.tokenLabel": "Bot token (optional now — can add later)",
    "onb.s2.help": "How to: 1) open @BotFather, 2) /newbot, 3) paste the token here.",
    "onb.s3.title": "First product",
    "onb.s3.desc": "At least one product so the bot has something to offer. Edit details later.",
    "onb.s3.namePh": "e.g. Espresso Blend 250g",
    "onb.s3.pricePh": "Price (USD)",
    "onb.s3.stockPh": "Stock on hand",
    "onb.s4.title": "Import customers",
    "onb.s4.desc": "Upload a CSV (email, name) — or use a demo seed if you're just testing.",
    "onb.s4.csv": "Upload CSV",
    "onb.s4.demo": "Seed demo customers",
    "onb.s4.csvHint": "Format: header row 'email,name'.",
    "onb.s5.title": "Tracking snippet",
    "onb.s5.desc": "Paste this on your site before </body>. We start seeing views, carts, purchases — without it agents only see historical data.",
    "onb.s5.copy": "Copy snippet",
    "onb.s5.copied": "Copied ✓",
    "onb.s6.title": "Payment method",
    "onb.s6.desc": "How customers pay. Manual is fine to start — Stripe can be wired later.",
    "onb.s6.manual": "Manual (bank / cash)",
    "onb.s6.stripe": "Stripe (connect later)",
    "onb.s7.title": "Invite teammates",
    "onb.s7.desc": "Emails of people who'll help run the brand. We'll send invites (skip is fine).",
    "onb.s7.emailPh": "colleague@example.com",
    "onb.s7.add": "Add",
    "onb.s7.invited": "Invited",

    "checklist.title": "Setup checklist",
    "checklist.desc": "Everything you need to launch the autonomous Revenue OS — in one place.",
    "checklist.continue": "Continue setup",
    "checklist.allDone": "All set — AI agents are running in the background 🚀",
    "checklist.s1": "Brand created",
    "checklist.s2": "Telegram channel connected",
    "checklist.s3": "At least 1 product",
    "checklist.s4": "Customers imported",
    "checklist.s5": "Tracking snippet installed",
    "checklist.s6": "Payment method chosen",
    "checklist.s7": "Team invited",

    "common.optional": "(optional)",
    "common.loading": "Loading…",
    "common.save": "Save",
    "common.cancel": "Cancel",
  },
} satisfies Record<Lang, Record<string, string>>;

export type TKey = keyof (typeof dict)["ua"];

let current: Lang = "ua";
const listeners = new Set<() => void>();

function readInitial(): Lang {
  if (typeof window === "undefined") return "ua";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "en" || saved === "ua" ? saved : "ua";
}

if (typeof window !== "undefined") {
  current = readInitial();
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, lang);
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook — компоненти автоматично перерендерюються при зміні мови. */
export function useT() {
  const lang = useSyncExternalStore(subscribe, () => current, () => "ua" as Lang);
  return {
    lang,
    setLang,
    t: (key: TKey, fallback?: string) => dict[lang][key] ?? fallback ?? key,
  };
}

/** Чистий helper (для не-React коду). */
export function tStatic(key: TKey, lang: Lang = current): string {
  return dict[lang][key] ?? key;
}
