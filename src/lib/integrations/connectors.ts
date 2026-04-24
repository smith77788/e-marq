/**
 * Конектори "ready" статусу — реальні pull-функції з зовнішніх API.
 * Всі повертають масив "сирих" рядків, які потім нормалізуються через runImport.
 *
 * Виконуються ВИКЛЮЧНО на сервері (мають доступ до credentials_encrypted).
 *
 * Підтримані провайдери:
 *   - shopify       — Admin REST API (X-Shopify-Access-Token)
 *   - woocommerce   — WC REST v3 (Basic Auth: consumer_key:consumer_secret)
 *   - stripe        — Stripe REST API (Bearer rk_...)
 *   - bitrix24      — Inbound webhook URL (crm.contact.list, crm.deal.list)
 *   - poster_pos    — Poster API (token у query)
 *   - google_sheets — публічний CSV-export з Google Sheets URL
 *   - rest_api      — generic REST: GET URL з опційним Authorization header
 */
import Papa from "papaparse";
import type { EntityKind, ParsedRow } from "./parser";
import { safeFetch } from "./safeFetch";
import {
  type DnOrder,
  type DnPartner,
  type DnProduct,
  listOrders,
  listPartners,
  listProducts,
  unwrapList,
  verifyApiKey as dntradeVerifyApiKey,
} from "@/lib/dntrade/client";

export type ConnectorPullInput = {
  provider: string;
  entityKind: EntityKind;
  /** credentials_encrypted (для apiKey/rest — це токен; для woocommerce — "key:secret") */
  credentials: string | null;
  /** config jsonb з tenant_integrations */
  config: Record<string, unknown>;
  /** Скільки максимум рядків витягнути за один запуск. */
  limit?: number;
};

export type ConnectorPullResult = {
  rows: ParsedRow[];
  /** Готовий маппінг (синтетичні поля connector → канонічні), якщо connector сам нормалізує. */
  mapping: Record<string, string>;
};

const DEFAULT_LIMIT = 250;

function ensure(value: string | null | undefined, label: string): string {
  if (!value || !String(value).trim()) {
    throw new Error(`Не задано: ${label}`);
  }
  return String(value).trim();
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

function centsFromMajor(amount: unknown): number {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsFromMinor(amount: unknown): number {
  const n = typeof amount === "number" ? amount : parseInt(String(amount ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHOPIFY
// ─────────────────────────────────────────────────────────────────────────────
async function pullShopify(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const token = ensure(input.credentials, "Shopify Admin API access token");
  const domainRaw = ensure((input.config.domain as string) ?? "", "домен магазину Shopify");
  const domain = domainRaw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, 250);
  const apiVersion = "2024-10";

  const resource =
    input.entityKind === "products"
      ? "products"
      : input.entityKind === "customers"
        ? "customers"
        : "orders";

  const url = new URL(`https://${domain}/admin/api/${apiVersion}/${resource}.json`);
  url.searchParams.set("limit", String(limit));
  if (resource === "orders") url.searchParams.set("status", "any");

  const res = await safeFetch(url.toString(), {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const items = (json[resource] as Array<Record<string, unknown>>) ?? [];

  const rows: ParsedRow[] = items.map((it): ParsedRow => {
    if (resource === "products") {
      const variants = (it.variants as Array<Record<string, unknown>>) ?? [];
      const v = variants[0] ?? {};
      const images = (it.images as Array<Record<string, unknown>>) ?? [];
      return {
        name: asString(it.title),
        sku: asString(v.sku),
        price_cents: centsFromMajor(v.price),
        stock: centsFromMinor(v.inventory_quantity),
        description: asString(it.body_html)
          .replace(/<[^>]+>/g, "")
          .slice(0, 2000),
        image_url: asString((images[0] as { src?: string } | undefined)?.src),
        currency: "UAH",
      };
    }
    if (resource === "customers") {
      return {
        name: `${asString(it.first_name)} ${asString(it.last_name)}`.trim() || asString(it.email),
        email: asString(it.email),
        phone: asString(it.phone),
        telegram_username: "",
      };
    }
    // orders
    const customer = (it.customer as Record<string, unknown>) ?? {};
    return {
      customer_name:
        `${asString(customer.first_name)} ${asString(customer.last_name)}`.trim() ||
        asString(it.email),
      customer_email: asString(it.email ?? customer.email),
      total_cents: centsFromMajor(it.total_price),
      currency: asString(it.currency || "UAH"),
      status: asString(it.financial_status || "pending"),
      payment_method: asString((it.payment_gateway_names as string[] | undefined)?.[0] ?? "manual"),
      external_id: asString(it.id),
    };
  });

  return { rows, mapping: identityMapping(input.entityKind) };
}

// ─────────────────────────────────────────────────────────────────────────────
// WOOCOMMERCE
// ─────────────────────────────────────────────────────────────────────────────
async function pullWooCommerce(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const cred = ensure(input.credentials, "WooCommerce ck:cs");
  const [ck, cs] = cred.includes(":") ? cred.split(":") : [cred, ""];
  if (!ck || !cs) throw new Error("WooCommerce credentials мають бути у форматі ck_xxx:cs_xxx");
  const baseRaw = ensure((input.config.domain as string) ?? "", "URL сайту WooCommerce");
  const base = baseRaw.replace(/\/$/, "");
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, 100);

  const resource =
    input.entityKind === "products"
      ? "products"
      : input.entityKind === "customers"
        ? "customers"
        : "orders";

  const url = `${base}/wp-json/wc/v3/${resource}?per_page=${limit}`;
  const auth = "Basic " + btoa(`${ck}:${cs}`);
  const res = await safeFetch(url, { headers: { Authorization: auth } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WooCommerce API ${res.status}: ${body.slice(0, 300)}`);
  }
  const items = (await res.json()) as Array<Record<string, unknown>>;

  const rows: ParsedRow[] = items.map((it): ParsedRow => {
    if (resource === "products") {
      const images = (it.images as Array<Record<string, unknown>>) ?? [];
      return {
        name: asString(it.name),
        sku: asString(it.sku),
        price_cents: centsFromMajor(it.price),
        stock: centsFromMinor(it.stock_quantity),
        description: asString(it.short_description)
          .replace(/<[^>]+>/g, "")
          .slice(0, 2000),
        image_url: asString((images[0] as { src?: string } | undefined)?.src),
        currency: "UAH",
      };
    }
    if (resource === "customers") {
      return {
        name: `${asString(it.first_name)} ${asString(it.last_name)}`.trim() || asString(it.email),
        email: asString(it.email),
        phone: asString((it.billing as { phone?: string } | undefined)?.phone),
        telegram_username: "",
      };
    }
    const billing = (it.billing as Record<string, unknown>) ?? {};
    return {
      customer_name: `${asString(billing.first_name)} ${asString(billing.last_name)}`.trim(),
      customer_email: asString(billing.email),
      total_cents: centsFromMajor(it.total),
      currency: asString(it.currency || "UAH"),
      status: asString(it.status || "pending"),
      payment_method: asString(it.payment_method ?? "manual"),
      external_id: asString(it.id),
    };
  });

  return { rows, mapping: identityMapping(input.entityKind) };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE
// ─────────────────────────────────────────────────────────────────────────────
async function pullStripe(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const key = ensure(input.credentials, "Stripe Restricted Key");
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, 100);
  if (input.entityKind === "products") {
    throw new Error(
      "Stripe не зберігає товари у каталозі — використайте customers або transactions.",
    );
  }

  const resource = input.entityKind === "customers" ? "customers" : "charges";
  const expand = resource === "charges" ? "&expand[]=data.customer&expand[]=data.billing_details" : "";
  const url = `https://api.stripe.com/v1/${resource}?limit=${limit}${expand}`;
  const res = await safeFetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Stripe API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const items = json.data ?? [];

  const rows: ParsedRow[] = items.map((it): ParsedRow => {
    if (resource === "customers") {
      return {
        name: asString(it.name) || asString(it.email),
        email: asString(it.email),
        phone: asString(it.phone),
        telegram_username: "",
      };
    }
    // charges → orders
    const billingDetails = (it.billing_details as Record<string, unknown>) ?? {};
    const paymentMethodDetails = (it.payment_method_details as Record<string, unknown>) ?? {};
    const expandedCustomer = (it.customer as Record<string, unknown> | null) ?? {};
    const customerEmail =
      asString(billingDetails.email) ||
      asString(expandedCustomer.email) ||
      asString(it.receipt_email);
    const customerName =
      asString(billingDetails.name) || asString(expandedCustomer.name) || customerEmail || "Stripe";
    return {
      customer_name: customerName,
      customer_email: customerEmail,
      total_cents: centsFromMinor(it.amount), // Stripe вже в копійках
      currency: asString(it.currency || "uah").toUpperCase(),
      status: it.paid ? "paid" : asString(it.status),
      payment_method: paymentMethodDetails.type ? "stripe_card" : "manual",
      external_id: asString(it.id),
    };
  });

  return { rows, mapping: identityMapping(input.entityKind) };
}

// ─────────────────────────────────────────────────────────────────────────────
// BITRIX24 (Inbound webhook URL)
// ─────────────────────────────────────────────────────────────────────────────
async function pullBitrix24(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const webhookUrl = ensure(input.credentials, "Bitrix24 Inbound webhook URL");
  const base = webhookUrl.replace(/\/$/, "");
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, 50);

  if (input.entityKind === "products") {
    throw new Error("Bitrix24 — лише клієнти/угоди. Для товарів використайте інше джерело.");
  }

  const method = input.entityKind === "customers" ? "crm.contact.list" : "crm.deal.list";
  const url = `${base}/${method}.json?start=0`;
  // Bitrix24 self-hosted часто на http — дозволяємо, але safeFetch блокує приватні IP.
  const res = await safeFetch(url, { allowHttp: true });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bitrix24 API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { result?: Array<Record<string, unknown>> };
  const items = (json.result ?? []).slice(0, limit);

  const rows: ParsedRow[] = items.map((it): ParsedRow => {
    if (input.entityKind === "customers") {
      const emails = (it.EMAIL as Array<{ VALUE?: string }>) ?? [];
      const phones = (it.PHONE as Array<{ VALUE?: string }>) ?? [];
      return {
        name: `${asString(it.NAME)} ${asString(it.LAST_NAME)}`.trim() || asString(emails[0]?.VALUE),
        email: asString(emails[0]?.VALUE),
        phone: asString(phones[0]?.VALUE),
        telegram_username: "",
      };
    }
    return {
      customer_name: asString(it.TITLE) || `Угода #${asString(it.ID)}`,
      customer_email: "",
      total_cents: centsFromMajor(it.OPPORTUNITY),
      currency: asString(it.CURRENCY_ID || "UAH"),
      status: asString(it.STAGE_ID).includes("WON") ? "paid" : "pending",
      payment_method: "manual",
      external_id: asString(it.ID),
    };
  });

  return { rows, mapping: identityMapping(input.entityKind) };
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTER POS
// ─────────────────────────────────────────────────────────────────────────────
async function pullPoster(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const token = ensure(input.credentials, "Poster API token");
  const domain = ((input.config.domain as string) || "joinposter.com").replace(/^https?:\/\//, "");
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, 250);

  const method =
    input.entityKind === "products"
      ? "menu.getProducts"
      : input.entityKind === "customers"
        ? "clients.getClients"
        : "transactions.getTransactions";

  const url = `https://${domain}/api/${method}?token=${encodeURIComponent(token)}&num=${limit}`;
  const res = await safeFetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Poster API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { response?: Array<Record<string, unknown>>; error?: unknown };
  if (json.error) throw new Error(`Poster API error: ${JSON.stringify(json.error)}`);
  const items = (json.response ?? []).slice(0, limit);

  const rows: ParsedRow[] = items.map((it): ParsedRow => {
    if (input.entityKind === "products") {
      return {
        name: asString(it.product_name),
        sku: asString(it.product_code),
        price_cents: centsFromMinor(
          typeof it.price === "object" && it.price
            ? Object.values(it.price as Record<string, unknown>)[0]
            : it.price,
        ),
        stock: 0,
        description: asString(it.product_description),
        image_url: asString(it.photo_origin),
        currency: "UAH",
      };
    }
    if (input.entityKind === "customers") {
      return {
        name: `${asString(it.firstname)} ${asString(it.lastname)}`.trim() || asString(it.email),
        email: asString(it.email),
        phone: asString(it.phone),
        telegram_username: "",
      };
    }
    return {
      customer_name: asString(it.client_id) || `Чек #${asString(it.transaction_id)}`,
      customer_email: "",
      total_cents: centsFromMinor(it.payed_sum),
      currency: "UAH",
      status: it.payed_sum ? "paid" : "pending",
      payment_method: "manual",
      external_id: asString(it.transaction_id),
    };
  });

  return { rows, mapping: identityMapping(input.entityKind) };
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE SHEETS (публічний URL → CSV-export)
// ─────────────────────────────────────────────────────────────────────────────
async function pullGoogleSheets(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const sheetUrl = ensure(
    (input.config.url as string) ?? input.credentials ?? "",
    "URL Google-таблиці",
  );
  // Витягуємо /spreadsheets/d/{ID}/...
  const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("Не вдалось розпізнати ID таблиці у URL");
  const sheetId = m[1];
  const gidMatch = sheetUrl.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  const res = await safeFetch(csvUrl);
  if (!res.ok) {
    throw new Error(
      `Не вдалось завантажити Google Sheet (${res.status}). Перевірте, що доступ "будь-хто з посиланням".`,
    );
  }
  const text = await res.text();
  const parsed = Papa.parse<ParsedRow>(text, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) =>
    Object.values(r).some((v) => v != null && v !== ""),
  );
  return { rows, mapping: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC REST
// ─────────────────────────────────────────────────────────────────────────────
async function pullRest(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const url = ensure((input.config.url as string) ?? "", "URL endpoint");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.credentials) headers.Authorization = input.credentials;

  const res = await safeFetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`REST ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  // Підтримуємо: масив, або об'єкт з {data: [...]} або {results: [...]}
  let items: Array<Record<string, unknown>> = [];
  if (Array.isArray(json)) items = json;
  else if (Array.isArray((json as { data?: unknown }).data))
    items = (json as { data: Array<Record<string, unknown>> }).data;
  else if (Array.isArray((json as { results?: unknown }).results))
    items = (json as { results: Array<Record<string, unknown>> }).results;
  else throw new Error("Очікувано масив у відповіді або поле data/results.");
  const rows: ParsedRow[] = items.map((it): ParsedRow => {
    const out: ParsedRow = {};
    for (const [k, v] of Object.entries(it)) out[k] = asString(v);
    return out;
  });
  return { rows, mapping: {} };
}

// Identity mapping для конекторів, які повертають уже канонічні поля.
function identityMapping(entityKind: EntityKind): Record<string, string> {
  const fields: Record<EntityKind, string[]> = {
    products: ["name", "sku", "price_cents", "stock", "description", "image_url", "currency"],
    customers: ["name", "email", "phone", "telegram_username"],
    orders: [
      "customer_name",
      "customer_email",
      "total_cents",
      "currency",
      "status",
      "payment_method",
      "external_id",
    ],
  };
  const m: Record<string, string> = {};
  for (const f of fields[entityKind]) m[f] = f;
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// DN TRADE (адаптер на існуючий typed-client; верифікація + пробний pull)
// Повний sync (повний/інкрементальний/dry-run) живе у /hooks/integrations/dntrade-sync.
// Цей адаптер дає universal-інтерфейс «verify» і легкий pull для перевірки.
// ─────────────────────────────────────────────────────────────────────────────
async function pullDnTrade(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const apiKey = ensure(input.credentials, "DN Trade ApiKey");
  const limit = Math.min(input.limit ?? 50, 50);

  if (input.entityKind === "products") {
    const resp = await listProducts(apiKey, { limit, offset: 0 });
    const items = unwrapList<DnProduct>(resp, "products").slice(0, limit);
    const rows: ParsedRow[] = items.map((p) => ({
      name: asString(p.title),
      sku: asString(p.sku ?? p.code),
      price_cents: centsFromMajor(p.price),
      stock: Math.max(0, Math.floor(Number(p.balance ?? 0))),
      description: asString(p.short_description ?? p.description),
      image_url: asString(p.image_path ?? p.images?.[0]),
      currency: "UAH",
    }));
    return { rows, mapping: identityMapping("products") };
  }

  if (input.entityKind === "customers") {
    const resp = await listPartners(apiKey, { limit, offset: 0 });
    const items = unwrapList<DnPartner>(resp, "partners").slice(0, limit);
    const rows: ParsedRow[] = items.map((c) => ({
      name: asString(c.title ?? c.full_title) || asString(c.email),
      email: asString(c.email),
      phone: asString(c.phone_number),
      telegram_username: "",
    }));
    return { rows, mapping: identityMapping("customers") };
  }

  // orders
  const resp = await listOrders(apiKey, { limit, offset: 0 });
  const items = unwrapList<DnOrder>(resp, "orders").slice(0, limit);
  const rows: ParsedRow[] = items.map((o) => ({
    customer_name: asString(o.personal_info?.name) || `Замовлення #${asString(o.number ?? o.external_id)}`,
    customer_email: "",
    total_cents: centsFromMajor(o.total ?? o.amount),
    currency: "UAH",
    status: o.paid ? "paid" : asString(o.status || "pending"),
    payment_method: "manual",
    external_id: asString(o.external_id),
  }));
  return { rows, mapping: identityMapping("orders") };
}

/** Швидка валідація DN Trade ApiKey (через дешевий /products/stores). */
export async function verifyDnTradeKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const r = await dntradeVerifyApiKey(apiKey);
  if (r.ok) return { ok: true };
  return { ok: false, error: `DN Trade ${r.status}: ${r.message}` };
}

export const CONNECTOR_REGISTRY: Record<
  string,
  (input: ConnectorPullInput) => Promise<ConnectorPullResult>
> = {
  shopify: pullShopify,
  woocommerce: pullWooCommerce,
  stripe: pullStripe,
  bitrix24: pullBitrix24,
  poster_pos: pullPoster,
  google_sheets: pullGoogleSheets,
  rest_api: pullRest,
  dntrade: pullDnTrade,
};

export function isConnectorSupported(provider: string): boolean {
  return provider in CONNECTOR_REGISTRY;
}

/** Translates raw safeFetch / network errors into UA-friendly text. */
function humanizeConnectorError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  // SSRF / private network blocks
  if (
    /приватні|локальні|metadata|приватну адресу|небезпечний протокол/i.test(raw) ||
    /Дозволено лише https/i.test(raw)
  ) {
    return new Error(
      "Цей URL не дозволено (приватна, локальна або небезпечна адреса). Використайте публічний https-домен.",
    );
  }
  if (/Невалідний URL/i.test(raw)) {
    return new Error("Некоректний URL. Перевірте, що адреса починається з https:// і містить домен.");
  }
  if (/Заборонено облікові дані в URL/i.test(raw)) {
    return new Error("Не вставляйте логін/пароль у URL. Передавайте ключ окремим полем.");
  }
  if (/Відповідь занадто велика/i.test(raw)) {
    return new Error("Відповідь зовнішнього API задовелика (>10 МБ). Зменшіть обсяг імпорту.");
  }
  // fetch failures (DNS, timeout, abort)
  if (/aborted|timeout|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(raw)) {
    return new Error(
      "Не вдалось підʼєднатись до сервера. Перевірте домен, мережу і доступність API.",
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

export async function runConnectorPull(input: ConnectorPullInput): Promise<ConnectorPullResult> {
  const fn = CONNECTOR_REGISTRY[input.provider];
  if (!fn) throw new Error(`Конектор "${input.provider}" не підтримує автоматичний імпорт.`);
  try {
    return await fn(input);
  } catch (e) {
    throw humanizeConnectorError(e);
  }
}
