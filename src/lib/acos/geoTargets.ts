/**
 * Geo targets — region scope for pricing & promo agents.
 *
 * Shape stored in DB (tenant_configs.geo_targets and agent_permissions.geo_targets):
 *   {
 *     country: "UA" | "PL" | ... (ISO-3166-1 alpha-2),
 *     cities: [{ ref?: string, name: string }],
 *     whole_country: boolean   // true => ignore cities, target whole country
 *   }
 *
 * Resolution rule:
 *   effective(agent) = agent_permissions.geo_targets ?? tenant_configs.geo_targets ?? DEFAULT
 *
 * Pricing agents use this to filter events/orders by metadata.country / metadata.city.
 * If `whole_country` is true OR `cities` is empty, only country filter applies.
 */

export type GeoCity = {
  ref?: string; // Nova Poshta DeliveryCity ref (UA only)
  name: string; // human-readable, used as filter key
};

export type GeoTargets = {
  country: string; // ISO-3166-1 alpha-2 (e.g. "UA")
  cities: GeoCity[];
  whole_country: boolean;
};

export const DEFAULT_GEO_TARGETS: GeoTargets = {
  country: "UA",
  cities: [],
  whole_country: true,
};

/** Common countries shown first in selector. Extend freely. */
export const COMMON_COUNTRIES: { code: string; nameUk: string; nameEn: string }[] = [
  { code: "UA", nameUk: "Україна", nameEn: "Ukraine" },
  { code: "PL", nameUk: "Польща", nameEn: "Poland" },
  { code: "DE", nameUk: "Німеччина", nameEn: "Germany" },
  { code: "CZ", nameUk: "Чехія", nameEn: "Czech Republic" },
  { code: "SK", nameUk: "Словаччина", nameEn: "Slovakia" },
  { code: "RO", nameUk: "Румунія", nameEn: "Romania" },
  { code: "MD", nameUk: "Молдова", nameEn: "Moldova" },
  { code: "LT", nameUk: "Литва", nameEn: "Lithuania" },
  { code: "LV", nameUk: "Латвія", nameEn: "Latvia" },
  { code: "EE", nameUk: "Естонія", nameEn: "Estonia" },
  { code: "GB", nameUk: "Велика Британія", nameEn: "United Kingdom" },
  { code: "US", nameUk: "США", nameEn: "USA" },
  { code: "CA", nameUk: "Канада", nameEn: "Canada" },
];

export function countryLabel(code: string, lang: "uk" | "en" = "uk"): string {
  const c = COMMON_COUNTRIES.find((x) => x.code === code.toUpperCase());
  if (!c) return code.toUpperCase();
  return lang === "en" ? c.nameEn : c.nameUk;
}

/** Safely parse value from DB column. */
export function parseGeoTargets(raw: unknown): GeoTargets | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const country =
    typeof r.country === "string" && r.country.length >= 2
      ? r.country.toUpperCase().slice(0, 2)
      : null;
  if (!country) return null;
  const cities: GeoCity[] = [];
  if (Array.isArray(r.cities)) {
    for (const c of r.cities) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      const name = typeof cc.name === "string" ? cc.name.trim() : "";
      if (!name) continue;
      const ref = typeof cc.ref === "string" ? cc.ref : undefined;
      cities.push({ ref, name });
    }
  }
  const whole_country = r.whole_country === true || cities.length === 0;
  return { country, cities, whole_country };
}

/** Resolve effective targets (agent override > brand > default). */
export function resolveGeoTargets(agentOverride: unknown, brandDefault: unknown): GeoTargets {
  return parseGeoTargets(agentOverride) ?? parseGeoTargets(brandDefault) ?? DEFAULT_GEO_TARGETS;
}

/** Predicate to filter a row by its metadata.country/city against geo targets. */
export function rowMatchesGeo(
  row: { metadata?: Record<string, unknown> | null } | null | undefined,
  geo: GeoTargets,
): boolean {
  if (!row) return false;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const rowCountry = typeof meta.country === "string" ? meta.country.toUpperCase() : null;
  // If row has no country tag, accept it (legacy data) — better than starving agents.
  if (rowCountry && rowCountry !== geo.country.toUpperCase()) return false;

  if (geo.whole_country || geo.cities.length === 0) return true;

  const rowCity = typeof meta.city === "string" ? meta.city.trim().toLowerCase() : null;
  if (!rowCity) return true; // again, accept untagged rows
  const wanted = new Set(geo.cities.map((c) => c.name.trim().toLowerCase()));
  return wanted.has(rowCity);
}

/** Human-readable summary, used in UI badges. */
export function summarizeGeo(geo: GeoTargets, lang: "uk" | "en" = "uk"): string {
  const cn = countryLabel(geo.country, lang);
  if (geo.whole_country || geo.cities.length === 0) {
    return lang === "en" ? `${cn} — whole country` : `${cn} — вся країна`;
  }
  if (geo.cities.length <= 2) {
    return `${cn}: ${geo.cities.map((c) => c.name).join(", ")}`;
  }
  return `${cn}: ${geo.cities[0].name} +${geo.cities.length - 1}`;
}
