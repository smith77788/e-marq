/**
 * Track recently visited pages in localStorage so the ⌘K palette
 * can surface them as a "Recent" group — like Linear / Notion / Raycast.
 *
 * Stored as a small ring buffer (max 8) of {path, label, ts}.
 * Persisted per-browser, no server round-trip.
 */
const KEY = "marq.recentPages.v1";
const MAX = 8;

export type RecentPage = {
  path: string;
  label: string;
  ts: number;
};

function read(): RecentPage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentPage =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as RecentPage).path === "string" &&
          typeof (x as RecentPage).label === "string" &&
          typeof (x as RecentPage).ts === "number",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function write(list: RecentPage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* quota — ignore */
  }
}

export function recordRecentPage(path: string, label: string) {
  if (!path || !label) return;
  // Skip noisy auth/onboarding paths
  if (path === "/" || path.startsWith("/login") || path.startsWith("/signup")) return;
  const now = Date.now();
  const list = read().filter((p) => p.path !== path);
  list.unshift({ path, label, ts: now });
  write(list);
}

export function getRecentPages(): RecentPage[] {
  return read();
}

export function clearRecentPages() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
