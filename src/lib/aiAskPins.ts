/**
 * aiAskPins — закріплені AI-запитання на дашборді бренду.
 *
 * Унікальна фіча: користувач натискає 📌 на відповіді в Command Palette →
 * запитання зберігається в localStorage (per-tenant). На дашборді
 * (CockpitHero / brand page) рендериться "live tile" — карточка, що
 * автоматично перезапитує `/api/ai/ask` кожні 5 хв і показує свіжу відповідь.
 *
 * Все детерміновано (без AI-кредитів): backend повертає intent-based answer.
 *
 * Storage shape:
 *   key: `acos.aiAsk.pins::<tenantId>`
 *   value: Pin[] (max 6, унікальні за question)
 */

const STORAGE_PREFIX = "acos.aiAsk.pins::";
const MAX_PINS = 6;
const EVENT_NAME = "acos:aiAskPins:changed";

export type AskPin = {
  id: string;
  question: string;
  /** Останній отриманий короткий answer (snippet, для миттєвого відображення). */
  lastAnswer?: string;
  pinnedAt: number;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function keyFor(tenantId: string): string {
  return `${STORAGE_PREFIX}${tenantId}`;
}

function emitChange(tenantId: string): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { tenantId } }));
  } catch {
    /* noop */
  }
}

export function getAskPins(tenantId: string | null): AskPin[] {
  if (!tenantId || !isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is AskPin =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as AskPin).id === "string" &&
          typeof (p as AskPin).question === "string",
      )
      .slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

export function isPinned(tenantId: string | null, question: string): boolean {
  if (!tenantId) return false;
  const trimmed = question.trim().toLowerCase();
  return getAskPins(tenantId).some((p) => p.question.trim().toLowerCase() === trimmed);
}

export function addAskPin(
  tenantId: string | null,
  question: string,
  lastAnswer?: string,
): AskPin | null {
  if (!tenantId || !isBrowser()) return null;
  const trimmed = question.trim();
  if (trimmed.length < 3) return null;
  try {
    const current = getAskPins(tenantId);
    const lower = trimmed.toLowerCase();
    if (current.some((p) => p.question.trim().toLowerCase() === lower)) return null;
    const pin: AskPin = {
      id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: trimmed,
      lastAnswer: lastAnswer?.slice(0, 400),
      pinnedAt: Date.now(),
    };
    const next = [pin, ...current].slice(0, MAX_PINS);
    window.localStorage.setItem(keyFor(tenantId), JSON.stringify(next));
    emitChange(tenantId);
    return pin;
  } catch {
    return null;
  }
}

export function removeAskPin(tenantId: string | null, pinId: string): void {
  if (!tenantId || !isBrowser()) return;
  try {
    const current = getAskPins(tenantId);
    const next = current.filter((p) => p.id !== pinId);
    window.localStorage.setItem(keyFor(tenantId), JSON.stringify(next));
    emitChange(tenantId);
  } catch {
    /* noop */
  }
}

export function updateAskPinAnswer(tenantId: string | null, pinId: string, answer: string): void {
  if (!tenantId || !isBrowser()) return;
  try {
    const current = getAskPins(tenantId);
    const next = current.map((p) =>
      p.id === pinId ? { ...p, lastAnswer: answer.slice(0, 400) } : p,
    );
    window.localStorage.setItem(keyFor(tenantId), JSON.stringify(next));
    emitChange(tenantId);
  } catch {
    /* noop */
  }
}

/** Підписка на зміни pins (для реактивних компонентів). */
export function subscribeAskPins(handler: (tenantId: string) => void): () => void {
  if (!isBrowser()) return () => {};
  const wrapped = (e: Event) => {
    const detail = (e as CustomEvent<{ tenantId: string }>).detail;
    if (detail?.tenantId) handler(detail.tenantId);
  };
  window.addEventListener(EVENT_NAME, wrapped);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}
