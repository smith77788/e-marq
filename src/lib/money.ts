/**
 * Centralised money formatting for the platform.
 *
 * All historical amounts are stored in `total_cents` / `price_cents` and the
 * project ledger uses currency code "UAH" by default. Older rows may still
 * carry "USD" but we render everything visually as гривні so the UI stays
 * consistent with the Ukrainian market positioning.
 *
 * Use `formatMoney(cents)` everywhere instead of hand-rolled `$${...}` /
 * `toLocaleString("en-US", { currency: "USD" })` calls.
 */
export const PLATFORM_CURRENCY = "UAH" as const;
export const PLATFORM_LOCALE = "uk-UA" as const;

const FULL = new Intl.NumberFormat(PLATFORM_LOCALE, {
  style: "currency",
  currency: PLATFORM_CURRENCY,
  maximumFractionDigits: 0,
});

const FULL_WITH_DECIMALS = new Intl.NumberFormat(PLATFORM_LOCALE, {
  style: "currency",
  currency: PLATFORM_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat(PLATFORM_LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Whole-hryvnia render ("12 345 ₴"). Use for KPIs, lists, totals.
 */
export function formatMoney(cents: number | null | undefined): string {
  const v = Math.round((cents ?? 0) / 100);
  return FULL.format(v);
}

/**
 * 2-decimal render ("12 345,67 ₴"). Use for ledger / accounting.
 */
export function formatMoneyExact(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return FULL_WITH_DECIMALS.format(v);
}

/**
 * Compact render ("12,3 тис. ₴"). Use only when space is critical (≤6 chars).
 */
export function formatMoneyCompact(cents: number | null | undefined): string {
  const v = Math.round((cents ?? 0) / 100);
  return `${COMPACT.format(v)} ₴`;
}

/** Just the number portion in uk-UA grouping ("12 345"). For axes / charts. */
export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(PLATFORM_LOCALE, { maximumFractionDigits: 0 }).format(value ?? 0);
}

/** Currency symbol ("₴"). */
export const HRYVNIA = "₴";
