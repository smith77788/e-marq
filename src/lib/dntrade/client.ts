/**
 * Minimal typed client for DN Trade REST API (https://api.dntrade.com.ua/).
 * Auth: header `ApiKey: <token>`. Rate limit: 100 req/min per token.
 *
 * We intentionally only model the fields we map into our DB; everything else
 * is passed through as `metadata` on inserts.
 */

const BASE_URL = "https://api.dntrade.com.ua";
const MAX_RETRIES_ON_429 = 3;

export type DnProduct = {
  product_id: string;
  sku?: string;
  code?: number;
  title: string;
  short_description?: string;
  description?: string;
  unit_title?: string;
  image_path?: string;
  images?: string[];
  price?: string | number;
  balance?: number;
  booked?: number;
  barcode?: string;
};

export type DnPartner = {
  external_id: string;
  tin?: string;
  title?: string;
  full_title?: string;
  phone_number?: string;
  address?: string;
  email?: string;
  birthday?: string;
  type?: string;
};

export type DnOrderCartItem = {
  product_id?: string;
  store_id?: string;
  price?: number;
  quantity?: number;
  title?: string;
};

export type DnOrder = {
  external_id: string;
  client_external_id?: string;
  date?: string;
  number?: number;
  paid?: number;
  status?: string;
  amount?: number | string;
  total?: number | string;
  cart?: DnOrderCartItem[];
  personal_info?: {
    name?: string;
    phone?: string;
    city?: string;
    street?: string;
  };
};

export class DnTradeError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "DnTradeError";
  }
}

async function request<T>(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  query?: Record<string, string | number | undefined>,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 8_000, 1_000), 12_000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: {
          ApiKey: apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new DnTradeError(`DN Trade ${method} ${path} timed out after ${timeoutMs}ms`, 408);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429 && attempt < MAX_RETRIES_ON_429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
      await new Promise((r) => setTimeout(r, Math.max(1000, retryAfter * 1000)));
      attempt++;
      continue;
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      throw new DnTradeError(
        `DN Trade ${method} ${path} failed: HTTP ${res.status}`,
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }
}

/** Verify ApiKey is valid by hitting a cheap endpoint. */
export async function verifyApiKey(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try {
    await request<unknown>(apiKey, "GET", "/products/stores", undefined, undefined, {
      timeoutMs: 6_000,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof DnTradeError) {
      return { ok: false, status: e.status, message: e.message };
    }
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function listProducts(
  apiKey: string,
  opts: { limit?: number; offset?: number; modified_from?: string; timeoutMs?: number } = {},
): Promise<{ status?: number; products?: DnProduct[] } | DnProduct[]> {
  // /products/list is POST; uses query params for filtering
  return request(
    apiKey,
    "POST",
    "/products/list",
    {
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      modified_from: opts.modified_from,
    },
    undefined,
    { timeoutMs: opts.timeoutMs },
  );
}

export async function listPartners(
  apiKey: string,
  opts: { limit?: number; offset?: number; timeoutMs?: number } = {},
): Promise<{ status?: number; partners?: DnPartner[] }> {
  return request(
    apiKey,
    "GET",
    "/partners/list",
    {
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    },
    undefined,
    { timeoutMs: opts.timeoutMs },
  );
}

export async function listOrders(
  apiKey: string,
  opts: {
    limit?: number;
    offset?: number;
    modified_from?: string;
    from_date?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ status?: number; orders?: DnOrder[] }> {
  return request(
    apiKey,
    "GET",
    "/orders/list",
    {
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      modified_from: opts.modified_from,
      from_date: opts.from_date,
    },
    undefined,
    { timeoutMs: opts.timeoutMs },
  );
}

/** Normalise a possibly-array or {products:[]} response to a flat array. */
export function unwrapList<T>(resp: unknown, key: string): T[] {
  if (Array.isArray(resp)) return resp as T[];
  if (resp && typeof resp === "object" && Array.isArray((resp as Record<string, unknown>)[key])) {
    return (resp as Record<string, T[]>)[key];
  }
  return [];
}
