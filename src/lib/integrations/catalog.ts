/**
 * Каталог усіх інтеграцій-джерел даних, які MARQ підтримує (або підтримуватиме).
 *
 * Кожна інтеграція має:
 *  - id (=  tenant_integrations.provider)
 *  - категорію (для UI)
 *  - метод підключення (apiKey | oauth | webhook | csv | sheets | rest)
 *  - чесний статус: ready | beta | webhookOnly | manualOnly | comingSoon
 *
 * Ми НЕ обіцяємо те, чого не реалізували. Якщо для повного OAuth потрібно,
 * щоб користувач сам зареєстрував app у провайдера — це чесно позначено
 * через `requires` і UI пропонує робочу альтернативу (наприклад, CSV-експорт
 * з тієї ж системи + наш імпорт).
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Bot,
  Calculator,
  CreditCard,
  Database,
  FileSpreadsheet,
  FileText,
  Globe,
  Hammer,
  Landmark,
  Link as LinkIcon,
  Package,
  Receipt,
  Server,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Webhook,
  Zap,
} from "lucide-react";

export type IntegrationCategory = "ecommerce" | "accounting" | "ukraine" | "universal" | "payments";

export type IntegrationStatus =
  | "ready" // Повністю працює одразу після введення ключа
  | "beta" // Працює, але можуть бути обмеження
  | "webhookOnly" // Тільки через webhook (не pull)
  | "manualOnly" // Тільки через CSV-експорт + наш імпорт
  | "comingSoon"; // Поки лише картка з інструкцією

export type ConnectionMethod =
  | "apiKey" // Один секретний ключ
  | "oauth" // OAuth flow (потрібна реєстрація app)
  | "webhook" // Тільки прийом webhook
  | "rest" // Generic REST: URL + headers
  | "csv" // Завантаження файлу
  | "sheets"; // Google Sheets через публічний CSV-export URL

export type IntegrationDef = {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  icon: LucideIcon;
  status: IntegrationStatus;
  method: ConnectionMethod;
  /** Що отримуємо від цього джерела. */
  imports: Array<"products" | "customers" | "orders" | "transactions" | "events">;
  /** Інструкція українською: 3-4 короткі кроки. */
  instructions: string[];
  /** Якщо інтеграція потребує сторонніх дій — тут чесний короткий опис. */
  requires?: string;
  /** Якщо є альтернативний шлях (зазвичай CSV-експорт) — підкажемо. */
  fallback?: string;
};

const BASE_INSTR_CSV = [
  "Експортуйте дані у форматі CSV або Excel з цієї системи.",
  "На картці натисніть «Завантажити файл».",
  "Перевірте мапінг колонок (система здогадається сама).",
  "Натисніть «Імпортувати» — і все.",
];

export const INTEGRATIONS: IntegrationDef[] = [
  // ───────── E-COMMERCE ─────────
  {
    id: "shopify",
    name: "Shopify",
    category: "ecommerce",
    description: "Імпорт товарів, клієнтів і замовлень з вашого магазину Shopify.",
    icon: ShoppingBag,
    status: "ready",
    method: "apiKey",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У Shopify Admin відкрийте Settings → Apps and sales channels → Develop apps.",
      "Створіть Custom App, дайте дозволи: read_products, read_customers, read_orders.",
      "Скопіюйте Admin API access token, введіть домен (my-shop.myshopify.com) і token нижче.",
      "Опційно — для миттєвого синку: у Shopify Admin → Settings → Notifications → Webhooks додайте orders/create + products/update з URL виду /api/public/integrations/inbound/shopify?tenant=<tenant_id> і HMAC secret з картки нижче.",
    ],
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    category: "ecommerce",
    description: "Підключення WordPress + WooCommerce магазину через REST API.",
    icon: Store,
    status: "ready",
    method: "apiKey",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У WordPress Admin: WooCommerce → Settings → Advanced → REST API.",
      "Натисніть «Add Key», виберіть Read access.",
      "Скопіюйте Consumer Key і Consumer Secret.",
      "Введіть URL сайту, key і secret нижче.",
    ],
  },
  {
    id: "etsy",
    name: "Etsy",
    category: "ecommerce",
    description: "Магазин на Etsy. Імпортуємо товари і замовлення.",
    icon: Sparkles,
    status: "comingSoon",
    method: "oauth",
    imports: ["products", "orders"],
    instructions: [
      "Etsy вимагає реєстрацію власного app у Etsy Developers.",
      "Поки готується OAuth — використайте CSV-експорт замовлень з Etsy.",
      "Завантажте CSV нижче — імпортується ідентично.",
    ],
    requires: "Реєстрація app у Etsy Developers Portal",
    fallback: "Поки що — CSV-експорт із вашого Etsy-аккаунта",
  },
  {
    id: "amazon",
    name: "Amazon Seller",
    category: "ecommerce",
    description: "Amazon Selling Partner API для товарів і замовлень.",
    icon: Package,
    status: "comingSoon",
    method: "oauth",
    imports: ["products", "orders"],
    instructions: [
      "Amazon SP-API вимагає Professional Selling Account і реєстрацію в Developer Console.",
      "Поки чекаємо повний OAuth — використовуйте Order Reports CSV з Seller Central.",
      "Завантажте файл нижче — система сама розпізнає формат.",
    ],
    requires: "Amazon Professional Account + SP-API Developer registration",
    fallback: "Order Reports CSV з Seller Central",
  },
  {
    id: "ebay",
    name: "eBay",
    category: "ecommerce",
    description: "Магазин на eBay. Імпорт лістингів і замовлень.",
    icon: ShoppingCart,
    status: "comingSoon",
    method: "oauth",
    imports: ["products", "orders"],
    instructions: [
      "eBay вимагає реєстрацію App Key у eBay Developers Program.",
      "Поки готується OAuth — використовуйте CSV-вигрузку Sales History.",
    ],
    requires: "eBay Developer App Key",
    fallback: "CSV Sales History з eBay Seller Hub",
  },

  // ───────── ACCOUNTING ─────────
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "accounting",
    description: "Бухгалтерія QuickBooks Online: клієнти, рахунки, транзакції.",
    icon: Calculator,
    status: "comingSoon",
    method: "oauth",
    imports: ["customers", "transactions"],
    instructions: [
      "QuickBooks вимагає реєстрацію app у Intuit Developer.",
      "Поки готується OAuth — експортуйте Customers і Transactions у CSV з QuickBooks.",
    ],
    requires: "Intuit Developer App + production keys",
    fallback: "CSV-експорт Customers + Sales з QuickBooks",
  },
  {
    id: "xero",
    name: "Xero",
    category: "accounting",
    description: "Хмарна бухгалтерія Xero: клієнти, інвойси, платежі.",
    icon: Landmark,
    status: "comingSoon",
    method: "oauth",
    imports: ["customers", "transactions"],
    instructions: [
      "Xero вимагає створення app у Xero Developer Portal.",
      "Поки чекаємо OAuth — експортуйте Contacts і Invoices CSV з Xero.",
    ],
    requires: "Xero Developer App + OAuth 2.0 credentials",
    fallback: "Contacts.csv + Invoices.csv з Xero",
  },
  {
    id: "freshbooks",
    name: "FreshBooks",
    category: "accounting",
    description: "FreshBooks: клієнти і виставлені рахунки.",
    icon: Receipt,
    status: "comingSoon",
    method: "oauth",
    imports: ["customers", "transactions"],
    instructions: ["Поки що використовуйте CSV-експорт Clients і Invoices з FreshBooks."],
    requires: "FreshBooks Developer App",
    fallback: "CSV-експорт з FreshBooks",
  },
  {
    id: "wave",
    name: "Wave",
    category: "accounting",
    description: "Безкоштовна бухгалтерія Wave для малого бізнесу.",
    icon: Receipt,
    status: "manualOnly",
    method: "csv",
    imports: ["customers", "transactions"],
    instructions: [
      "У Wave: Reports → Customer Statements або Sales by Customer.",
      "Експортуйте у CSV.",
      "Завантажте CSV нижче.",
    ],
    fallback: "CSV-експорт зі звітів Wave",
  },

  // ───────── PAYMENTS ─────────
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    description: "Платежі Stripe: транзакції, клієнти, повернення.",
    icon: CreditCard,
    status: "ready",
    method: "apiKey",
    imports: ["customers", "transactions"],
    instructions: [
      "У Stripe Dashboard: Developers → API keys.",
      "Скопіюйте Restricted Key з правами Read для Customers, Charges, PaymentIntents.",
      "Вставте ключ нижче (формат rk_live_...).",
    ],
  },

  // ───────── UKRAINE / СНД ─────────
  {
    id: "dntrade",
    name: "DN Trade",
    category: "ukraine",
    description:
      "Українська ERP/складська система: товари, склади, клієнти й замовлення. Має повний health-check, dry-run і webhook.",
    icon: Database,
    status: "ready",
    method: "apiKey",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У кабінеті DN Trade: Профіль → API → створити ApiKey з правами читання.",
      "Скопіюйте ApiKey (формат довгий рядок).",
      "Вставте ключ у поле нижче — ми перевіримо його через GET /products/stores.",
      "Після підключення відкриється спеціальне меню: повний sync, інкрементальний sync, dry-run і webhook.",
    ],
    requires: "Активний акаунт DN Trade з доступом до API",
  },
  {
    id: "bitrix24",
    name: "Bitrix24",
    category: "ukraine",
    description: "CRM Bitrix24: ліди, контакти, угоди.",
    icon: Database,
    status: "ready",
    method: "apiKey",
    imports: ["customers", "orders"],
    instructions: [
      "У Bitrix24: «Розробникам» → «Інші» → «Inbound webhook».",
      "Дайте дозволи: crm (CRM) і user (Користувачі).",
      "Скопіюйте URL вебхука цілком (формат https://ваш.bitrix24.ua/rest/1/КЛЮЧ/).",
      "Вставте URL нижче.",
    ],
  },
  {
    id: "poster_pos",
    name: "Poster POS",
    category: "ukraine",
    description: "Каса Poster POS для кафе/ресторанів. Імпорт чеків і клієнтів.",
    icon: Receipt,
    status: "ready",
    method: "apiKey",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У Poster: Налаштування → Інтеграції → Створити Application.",
      "Скопіюйте Application Token.",
      "Вставте акаунт-домен (напр.: joinposter.com) і token нижче.",
    ],
  },
  {
    id: "checkbox",
    name: "Checkbox",
    category: "ukraine",
    description: "Програмний РРО Checkbox: фіскальні чеки і зміни.",
    icon: Receipt,
    status: "beta",
    method: "apiKey",
    imports: ["orders"],
    instructions: [
      "У Checkbox: Кабінет → Налаштування → API.",
      "Створіть пару login + pin-код для каси.",
      "Введіть login і pin нижче — ми будемо тягнути чеки за добу.",
    ],
  },
  {
    id: "1c",
    name: "1С Підприємство",
    category: "ukraine",
    description: "1С: Бухгалтерія / 1С: Управління торгівлею.",
    icon: Server,
    status: "manualOnly",
    method: "csv",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У 1С: оберіть документ або довідник → «Файл» → «Зберегти як» → CSV (з роздільником ;).",
      "Або налаштуйте обмін через XML/JSON у регламентних завданнях 1С.",
      "Завантажте отриманий файл нижче — система розпізнає кодування CP1251 та UTF-8.",
    ],
    fallback: "CSV або XML-вигрузка з 1С",
  },
  {
    id: "bas",
    name: "BAS Бухгалтерія",
    category: "ukraine",
    description: "BAS — українська платформа на базі 1С 8.",
    icon: Server,
    status: "manualOnly",
    method: "csv",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У BAS: довідник → Дії → Зберегти список → CSV.",
      "Або через стандартний обробник «Універсальний обмін даними» XML.",
      "Завантажте файл нижче.",
    ],
    fallback: "CSV-вигрузка з BAS",
  },
  {
    id: "diia_city",
    name: "Дія.City API",
    category: "ukraine",
    description: "Інтеграція з реєстрами Дія.City для резидентів.",
    icon: Hammer,
    status: "comingSoon",
    method: "rest",
    imports: ["customers"],
    instructions: [
      "Дія.City API доступний резидентам. Потрібен сертифікат і доступ до API.",
      "Поки що — використовуйте Generic REST конектор внизу і вкажіть endpoint Дії.",
    ],
    requires: "Сертифікат резидента Дія.City + доступ до API",
  },

  // ───────── UNIVERSAL ─────────
  {
    id: "csv",
    name: "CSV / Excel файл",
    category: "universal",
    description: "Завантажте будь-який CSV або XLSX — товари, клієнти, замовлення.",
    icon: FileSpreadsheet,
    status: "ready",
    method: "csv",
    imports: ["products", "customers", "orders"],
    instructions: BASE_INSTR_CSV,
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    category: "universal",
    description: "Підключіть Google-таблицю — будемо синхронізувати щогодини.",
    icon: FileText,
    status: "ready",
    method: "sheets",
    imports: ["products", "customers", "orders"],
    instructions: [
      "У Google Sheets: Файл → Поділитися → «Будь-хто з посиланням може переглядати».",
      "Скопіюйте URL аркуша.",
      "Вставте URL нижче і виберіть тип даних.",
      "Ми автоматично оновлюватимемо щогодини.",
    ],
  },
  {
    id: "rest_api",
    name: "Власний REST API",
    category: "universal",
    description: "Будь-який API: вкажіть URL, headers — ми будемо тягнути JSON.",
    icon: Globe,
    status: "ready",
    method: "rest",
    imports: ["products", "customers", "orders"],
    instructions: [
      "Вкажіть URL вашого endpoint, який повертає JSON.",
      "Додайте headers (наприклад, Authorization: Bearer ...) — за потреби.",
      "Виберіть, який тип даних повертає endpoint.",
      "Налаштуйте автоматичний запуск (щогодини / щодоби).",
    ],
  },
  {
    id: "webhook_generic",
    name: "Webhook (Zapier / Make.com)",
    category: "universal",
    description: "Готовий endpoint для будь-якої платформи автоматизації.",
    icon: Webhook,
    status: "ready",
    method: "webhook",
    imports: ["products", "customers", "orders", "events"],
    instructions: [
      "Створіть Zap у Zapier (або сценарій у Make.com).",
      "Виберіть дію «Webhook → POST».",
      "Скопіюйте URL і секретний підпис нижче.",
      "Вкажіть їх у Zapier/Make — і ваші дані потечуть до MARQ.",
    ],
  },
  {
    id: "zapier",
    name: "Zapier",
    category: "universal",
    description: "Готова інтеграція з 5000+ застосунків через Zapier.",
    icon: Zap,
    status: "ready",
    method: "webhook",
    imports: ["products", "customers", "orders", "events"],
    instructions: [
      "Створіть новий Zap у Zapier.",
      "Trigger — будь-який з 5000+ застосунків (Gmail, HubSpot, Mailchimp...).",
      "Action — Webhook by Zapier → POST.",
      "Скопіюйте URL нижче і вставте у Zapier.",
    ],
  },
  {
    id: "make",
    name: "Make.com (Integromat)",
    category: "universal",
    description: "Альтернатива Zapier: конструктор сценаріїв з 1500+ застосунків.",
    icon: Activity,
    status: "ready",
    method: "webhook",
    imports: ["products", "customers", "orders", "events"],
    instructions: [
      "Створіть сценарій у Make.com.",
      "Додайте модуль HTTP → Make a request → POST.",
      "Скопіюйте URL і підпис нижче, вставте в HTTP-модуль Make.",
    ],
  },
];

export const CATEGORIES: { id: IntegrationCategory; label: string; icon: LucideIcon }[] = [
  { id: "ecommerce", label: "E-commerce магазини", icon: ShoppingBag },
  { id: "accounting", label: "Бухгалтерія", icon: Calculator },
  { id: "payments", label: "Платіжні системи", icon: CreditCard },
  { id: "ukraine", label: "Україна / СНД", icon: Landmark },
  { id: "universal", label: "Універсальні (CSV, API, Webhook)", icon: LinkIcon },
];

export const STATUS_LABELS: Record<IntegrationStatus, { label: string; tone: string }> = {
  ready: { label: "Готово до підключення", tone: "bg-success/15 text-success border-success/30" },
  beta: { label: "У бета-режимі", tone: "bg-primary/15 text-primary border-primary/30" },
  webhookOnly: {
    label: "Тільки через webhook",
    tone: "bg-secondary/30 text-foreground border-border",
  },
  manualOnly: { label: "Через CSV-експорт", tone: "bg-secondary/30 text-foreground border-border" },
  comingSoon: { label: "Скоро", tone: "bg-muted text-muted-foreground border-border" },
};

export const METHOD_LABELS: Record<ConnectionMethod, string> = {
  apiKey: "Ключ доступу",
  oauth: "OAuth (потрібна реєстрація)",
  webhook: "Webhook",
  rest: "REST API",
  csv: "Файл CSV / Excel",
  sheets: "Google Sheets",
};

export function getIntegration(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function listByCategory(category: IntegrationCategory): IntegrationDef[] {
  return INTEGRATIONS.filter((i) => i.category === category);
}

export const ICONS_BY_PROVIDER: Record<string, LucideIcon> = Object.fromEntries(
  INTEGRATIONS.map((i) => [i.id, i.icon]),
);
export { Bot, BarChart3 };
