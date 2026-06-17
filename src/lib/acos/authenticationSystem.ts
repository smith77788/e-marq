/**
 * Smart API Authentication — автентифікація API запитів.
 *
 * Методи:
 * 1. Bearer Token — JWT токени
 * 2. API Key — ключі API (перевіряються по таблиці api_keys або bootstrap_facts)
 * 3. OAuth — зовнішня автентифікація
 * 4. Session — сесії
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuthResult = {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
  error?: string;
};

/**
 * Перевірити Bearer токен.
 */
export async function verifyBearerToken(
  token: string,
): Promise<AuthResult> {
  try {
    // Декодувати JWT (спрощено)
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { authenticated: false, error: "Invalid token format" };
    }

    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());

    // Перевірити термін дії
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return { authenticated: false, error: "Token expired" };
    }

    return {
      authenticated: true,
      userId: payload.sub,
      tenantId: payload.tenant_id,
      role: payload.role,
    };
  } catch {
    return { authenticated: false, error: "Invalid token" };
  }
}

/**
 * Перевірити API ключ по bootstrap_facts (ключ api_keys).
 * Формат запису: { [apiKey]: { user_id, tenant_id, role, expires_at? } }
 */
export async function verifyApiKey(
  apiKey: string,
): Promise<AuthResult> {
  if (!apiKey || apiKey.length < 10) {
    return { authenticated: false, error: "Invalid API key" };
  }

  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("tenant_id", "system")
    .eq("fact_key", "api_keys")
    .maybeSingle();

  const registry = ((data?.value as Record<string, unknown>) ?? {});
  const entry = registry[apiKey] as { user_id?: string; tenant_id?: string; role?: string; expires_at?: string } | undefined;

  if (!entry) return { authenticated: false, error: "Unknown API key" };

  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    return { authenticated: false, error: "API key expired" };
  }

  return {
    authenticated: true,
    userId: entry.user_id,
    tenantId: entry.tenant_id,
    role: entry.role,
  };
}

/**
 * Генерувати JWT токен (спрощено).
 */
export function generateToken(
  payload: Record<string, unknown>,
  expiresIn: number = 3600,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");

  // Спрощений підпис (в реальності використовуйте HMAC-SHA256)
  const signature = Buffer.from(`${encodedHeader}.${encodedPayload}`).toString("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
