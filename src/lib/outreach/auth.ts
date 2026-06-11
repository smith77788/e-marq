/**
 * Авторизація для outreach hooks.
 * Підтримує:
 *   - cron виклик (anon key у Authorization, як в інших lead/acos hooks)
 *   - супер-адміна (JWT)
 *   - учасника бренду (JWT) — якщо є тіло з tenant_id або X-Tenant-Id header.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { isCronToken } from "@/lib/acos/cronAuth";
import { loadFanoutTenantIds } from "@/lib/acos/fanoutTenants";

export type OutreachAuth =
  | { kind: "cron" }
  | { kind: "super"; userId: string }
  | { kind: "member"; userId: string; tenantId: string };

export async function authorizeOutreach(
  request: Request,
  desiredTenantId: string | null,
): Promise<OutreachAuth | { error: string; status: number }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Missing bearer token", status: 401 };

  if (isCronToken(token)) return { kind: "cron" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { error: "Server not configured", status: 500 };

  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { error: "Invalid token", status: 401 };
  const userId = data.claims.sub;

  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  if ((roles ?? []).length > 0) return { kind: "super", userId };

  if (desiredTenantId) {
    const { data: mem } = await supabaseAdmin
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", desiredTenantId)
      .limit(1);
    if ((mem ?? []).length > 0) return { kind: "member", userId, tenantId: desiredTenantId };
  }
  return { error: "Forbidden", status: 403 };
}

/** Тенанти, для яких треба запускати агента (cron → всі активні; user → лише його). */
export async function resolveTargetTenants(
  auth: OutreachAuth,
  hint: string | null,
): Promise<string[]> {
  if (auth.kind === "member") return [auth.tenantId];
  if (auth.kind === "super") {
    if (hint) return [hint];
    return loadFanoutTenantIds(50);
  }
  // cron — всі активні tenants (active + pending)
  if (hint) return [hint];
  return loadFanoutTenantIds(100);
}
