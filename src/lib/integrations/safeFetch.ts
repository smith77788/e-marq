/**
 * SSRF-захищений fetch для конекторів.
 * Блокує:
 *  - не-https (крім localhost у dev — тут завжди забороняємо)
 *  - приватні діапазони IP (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7)
 *  - hostnames "localhost", "metadata.google.internal", "metadata"
 *  - редиректи більше 3
 *  - timeout > 15s
 *  - response > 10 MB
 */
const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
]);

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (FORBIDDEN_HOSTS.has(h)) return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (PRIVATE_IPV4.some((r) => r.test(h))) return true;
  // IPv6 loopback / link-local / ULA
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

export type SafeFetchOptions = {
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  /** Дозволити http (за замовч. лише https). Використовуй ТІЛЬКИ для довірених конекторів типу Bitrix self-hosted. */
  allowHttp?: boolean;
  timeoutMs?: number;
  /** Мб */
  maxResponseMb?: number;
};

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Невалідний URL");
  }

  const allowHttp = opts.allowHttp === true;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error(`Дозволено лише https://${allowHttp ? " або http://" : ""} URL`);
  }

  if (isPrivateHost(url.hostname)) {
    throw new Error("Заборонено: приватні / локальні / metadata-адреси");
  }

  // Заборонено user:pass у URL
  if (url.username || url.password) {
    throw new Error("Заборонено облікові дані в URL");
  }

  const timeoutMs = Math.min(opts.timeoutMs ?? 15_000, 15_000);
  const maxBytes = (opts.maxResponseMb ?? 10) * 1024 * 1024;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "manual", // не слідуємо за редиректами автоматично — ризик SSRF через redirect
    });

    // Якщо сервер повертає редирект — перевіряємо локацію і обмежуємо до 3
    let current = res;
    let hops = 0;
    while ((current.status === 301 || current.status === 302 || current.status === 307 || current.status === 308) && hops < 3) {
      const loc = current.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, url);
      if (next.protocol !== "https:" && !(allowHttp && next.protocol === "http:")) {
        throw new Error("Редирект на небезпечний протокол");
      }
      if (isPrivateHost(next.hostname)) {
        throw new Error("Редирект на приватну адресу заборонено");
      }
      hops++;
      current = await fetch(next.toString(), {
        method: opts.method ?? "GET",
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
        redirect: "manual",
      });
    }

    // Захист від велетенського response (читаємо у Buffer з лімітом)
    const contentLength = parseInt(current.headers.get("content-length") ?? "0", 10);
    if (contentLength > maxBytes) {
      throw new Error(`Відповідь занадто велика (${contentLength} байт)`);
    }
    return current;
  } finally {
    clearTimeout(timer);
  }
}
