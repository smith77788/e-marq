/**
 * aiAskHistory — локальна історія запитів до AI Ask, збережена у localStorage.
 * Без зовнішніх залежностей, без серверних викликів. Per-tenant ізоляція.
 *
 * Ключ: `acos.aiAsk.history::<tenantId>` → масив рядків, max 8, унікальні,
 * найсвіжіший — перший.
 */

const STORAGE_PREFIX = "acos.aiAsk.history::";
const MAX_ITEMS = 8;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function keyFor(tenantId: string): string {
  return `${STORAGE_PREFIX}${tenantId}`;
}

export function getAskHistory(tenantId: string | null): string[] {
  if (!tenantId || !isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function pushAskHistory(tenantId: string | null, question: string): void {
  if (!tenantId || !isBrowser()) return;
  const trimmed = question.trim();
  if (trimmed.length < 3) return;
  try {
    const current = getAskHistory(tenantId);
    const deduped = [trimmed, ...current.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())];
    const next = deduped.slice(0, MAX_ITEMS);
    window.localStorage.setItem(keyFor(tenantId), JSON.stringify(next));
  } catch {
    /* ignore quota / parse errors */
  }
}

export function clearAskHistory(tenantId: string | null): void {
  if (!tenantId || !isBrowser()) return;
  try {
    window.localStorage.removeItem(keyFor(tenantId));
  } catch {
    /* ignore */
  }
}

/** Стартові підказки — детерміновані, мовно-нейтральні (UA). */
export const STARTER_PROMPTS: string[] = [
  "Як виторг за 30 днів?",
  "Які зараз інсайти?",
  "Стан агентів",
  "Що зі складом?",
  "Топ-товари",
  "Конверсія",
];
