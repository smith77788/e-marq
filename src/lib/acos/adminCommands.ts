/**
 * Каталог усіх адмін-команд (серверних хуків) з людськими описами.
 * Кожна команда — POST на /hooks/... з { tenant_id } у тілі.
 */

export type CommandScope = "tenant" | "global";

export type AdminCommand = {
  id: string;
  /** Шлях для fetch (без хосту) */
  path: string;
  /** Українська назва */
  title: string;
  /** Що робить — одним реченням */
  description: string;
  /** Потрібен tenant_id у тілі? */
  scope: CommandScope;
  /** Додаткові поля JSON, які можна редагувати перед запуском */
  extraBody?: Record<string, unknown>;
};

export type CommandGroup = {
  key: string;
  title: string;
  description: string;
  commands: AdminCommand[];
};

/** Орркестратори — запускають усе одразу */
const ORCHESTRATORS: AdminCommand[] = [
  {
    id: "cron-all",
    path: "/hooks/agents/cron-all",
    title: "Запустити всіх агентів по всіх брендах",
    description: "Аналог щоденного крон-завдання. Проходить всі активні бренди та запускає для кожного повний пакет агентів.",
    scope: "global",
  },
  {
    id: "run-all",
    path: "/hooks/agents/run-all",
    title: "Запустити повний пакет агентів для бренду",
    description: "Виконує одразу 70+ агентів для обраного бренду паралельно.",
    scope: "tenant",
  },
  {
    id: "tick",
    path: "/hooks/agents/tick",
    title: "Швидкий тік (легкі агенти)",
    description: "Запускає лише швидкі агенти, які мають крутитись часто протягом дня.",
    scope: "tenant",
  },
  {
    id: "feedback-loop-all",
    path: "/hooks/agents/feedback-loop-all",
    title: "Цикл навчання по всіх брендах",
    description: "Оновлює пам'ять і ваги моделей на основі недавніх результатів.",
    scope: "global",
  },
  {
    id: "sales-bot-all",
    path: "/hooks/agents/sales-bot-all",
    title: "Бот продажів — для всіх брендів",
    description: "Запускає торгового бота для кожного активного бренду.",
    scope: "global",
  },
];

/** Двигуни виконання — фактично відправляють повідомлення / роблять дії */
const ENGINES: AdminCommand[] = [
  {
    id: "dispatch",
    path: "/hooks/engines/dispatch",
    title: "Відправити чергу повідомлень",
    description: "Розсилає всі готові вихідні повідомлення обраного бренду каналами клієнтів.",
    scope: "tenant",
  },
  {
    id: "abandoned-cart",
    path: "/hooks/engines/abandoned-cart",
    title: "Повернення кошиків — один бренд",
    description: "Знаходить покинуті кошики й готує повідомлення для повернення клієнтів.",
    scope: "tenant",
  },
  {
    id: "abandoned-cart-all",
    path: "/hooks/engines/abandoned-cart-all",
    title: "Повернення кошиків — усі бренди",
    description: "Те ж саме, але одразу по всіх брендах.",
    scope: "global",
  },
  {
    id: "reorder",
    path: "/hooks/engines/reorder",
    title: "Повторні замовлення — один бренд",
    description: "Пропонує клієнтам повторити замовлення в потрібний час циклу.",
    scope: "tenant",
  },
  {
    id: "reorder-all",
    path: "/hooks/engines/reorder-all",
    title: "Повторні замовлення — усі бренди",
    description: "Запускає двигун повторних замовлень глобально.",
    scope: "global",
  },
  {
    id: "winback",
    path: "/hooks/engines/winback",
    title: "Повернення «сплячих» — один бренд",
    description: "Знаходить клієнтів, які давно не купували, і запускає кампанію повернення.",
    scope: "tenant",
  },
  {
    id: "winback-all",
    path: "/hooks/engines/winback-all",
    title: "Повернення «сплячих» — усі бренди",
    description: "Глобальний запуск двигуна повернення.",
    scope: "global",
  },
  {
    id: "winback-one",
    path: "/hooks/engines/winback-one",
    title: "Повернення для одного клієнта",
    description: "Точкова відправка повідомлення повернення конкретному клієнту (потрібен customer_id).",
    scope: "tenant",
    extraBody: { customer_id: "" },
  },
];

/** Telegram-операції */
const TELEGRAM: AdminCommand[] = [
  {
    id: "telegram-poll",
    path: "/hooks/telegram/poll",
    title: "Опитати оновлення Telegram",
    description: "Стягує нові повідомлення з Telegram Bot API (long-poll).",
    scope: "global",
  },
  {
    id: "telegram-notify-owner",
    path: "/hooks/telegram/notify-owner",
    title: "Розіслати сповіщення власнику",
    description: "Відправляє чергу сповіщень власнику бренду через Telegram.",
    scope: "tenant",
    extraBody: { kind: "insight" },
  },
];

/** Системні / дані */
const SYSTEM: AdminCommand[] = [
  {
    id: "demo-seed",
    path: "/hooks/demo/seed",
    title: "Заповнити бренд демо-даними",
    description: "Створює 8 товарів, 25 клієнтів, 90 днів замовлень + події воронки. Безпечно для існуючих даних.",
    scope: "tenant",
    extraBody: { force: false },
  },
  {
    id: "ingest",
    path: "/hooks/ingest",
    title: "Тестова подія для ingest",
    description: "Надсилає одну подію в трекер (для перевірки пайплайну).",
    scope: "tenant",
    extraBody: { type: "product_viewed", payload: {} },
  },
  {
    id: "actions-apply",
    path: "/hooks/actions/apply",
    title: "Застосувати схвалену дію",
    description: "Виконує конкретну дію зі списку pending. Потрібен action_id.",
    scope: "tenant",
    extraBody: { action_id: "" },
  },
];

/** Окремі агенти — індивідуальний запуск */
const INDIVIDUAL_AGENTS: { id: string; path: string }[] = [
  "onboarding", "churn-risk", "stockout", "aov-leak", "search-gap",
  "aov-optimizer", "price-optimizer", "price-revert", "bot-quality",
  "segmentation", "memory-feedback",
  "margin-optimizer", "ltv-predictor", "cart-recovery", "anomaly-detector",
  "morning-brief", "bundle-recommender", "promo-fatigue", "promo-portfolio",
  "discount-elasticity", "predictive-pricing", "cohort-engine", "attribution",
  "funnel-healer", "browse-abandonment", "second-order-nurture",
  "bot-sequences", "broadcast-composer", "best-time-to-send",
  "csat-dispatcher", "nurture-roi", "seo-rewriter", "content-velocity",
  "ugc-harvester", "search-intent-miner", "programmatic-seo",
  "customer-segments-auto", "loyalty-tiers", "product-affinity",
  "customer-churn-predictor", "first-order-funnel", "inventory-forecast",
  "restock-alert", "anti-fraud", "action-watchdog", "conflict-resolver",
  "social-proof-live", "broadcast-roi", "winback-roi", "elasticity-meta-loop",
  "learning-loop-monitor", "notification-router", "daily-digest-v2",
  "owner-playbook", "meta-prior-injector", "autonomous-seo-loop",
  "shipping-optimizer", "return-predictor", "vip-concierge",
  "review-velocity", "payment-retry", "geo-demand", "time-of-day-pricer",
  "refund-risk", "lifecycle-trigger-tuner", "inventory-rebalance",
  "feedback-loop", "sales-bot",
].map((id) => ({ id, path: `/hooks/agents/${id}` }));

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    key: "orchestrators",
    title: "Оркестратори",
    description: "Запускають одразу багато агентів. Найшвидший спосіб «розворушити» систему.",
    commands: ORCHESTRATORS,
  },
  {
    key: "engines",
    title: "Двигуни виконання",
    description: "Фактично відправляють повідомлення клієнтам та виконують дії.",
    commands: ENGINES,
  },
  {
    key: "telegram",
    title: "Telegram",
    description: "Опитування оновлень та доставка сповіщень власнику.",
    commands: TELEGRAM,
  },
  {
    key: "system",
    title: "Система та дані",
    description: "Сід демо-даних, тестові події, ручне застосування дій.",
    commands: SYSTEM,
  },
];

/** Допоміжне: побудувати список окремих агентів з людськими підписами. */
export function getIndividualAgents() {
  return INDIVIDUAL_AGENTS;
}
