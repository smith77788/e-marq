/**
 * Smart API Versioning — версіонування API.
 *
 * Стратегії:
 * 1. URL versioning — /api/v1/...
 * 2. Header versioning — Accept-Version: v1
 * 3. Query param versioning — ?version=v1
 */

export type ApiVersionConfig = {
  current: string;
  supported: string[];
  deprecated: string[];
  sunsetDate?: string;
};

const VERSION_CONFIG: ApiVersionConfig = {
  current: "v2",
  supported: ["v1", "v2"],
  deprecated: ["v1"],
  sunsetDate: "2026-12-31",
};

/**
 * Визначити версію API з запиту.
 */
export function resolveApiVersion(request: Request): string {
  // 1. Check URL path
  const url = new URL(request.url);
  const pathMatch = url.pathname.match(/^\/api\/(v\d+)\//);
  if (pathMatch) return pathMatch[1];

  // 2. Check Accept-Version header
  const acceptVersion = request.headers.get("Accept-Version");
  if (acceptVersion && VERSION_CONFIG.supported.includes(acceptVersion)) {
    return acceptVersion;
  }

  // 3. Check query param
  const versionParam = url.searchParams.get("version");
  if (versionParam && VERSION_CONFIG.supported.includes(versionParam)) {
    return versionParam;
  }

  // Default to current version
  return VERSION_CONFIG.current;
}

/**
 * Перевірити чи версія deprecated.
 */
export function isDeprecated(version: string): boolean {
  return VERSION_CONFIG.deprecated.includes(version);
}

/**
 * Отримати заголовки deprecated.
 */
export function getDeprecationHeaders(version: string): Record<string, string> {
  if (!isDeprecated(version)) return {};

  return {
    "Deprecation": "true",
    "Sunset": VERSION_CONFIG.sunsetDate ?? "",
    "Link": `</api/${VERSION_CONFIG.current}>; rel="successor-version"`,
  };
}
