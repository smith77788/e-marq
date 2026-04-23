/**
 * Спільна авторизація для /api/telegram/user/* роутів.
 * Перевіряє Bearer-токен користувача та право керувати tenant.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuthOk = { ok: true; userId: string };
export type AuthErr = { ok: false; status: number; error: string };

export async function authBearer(req: Request): Promise<AuthOk | AuthErr> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing_bearer" };
  const token = auth.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "empty_token" };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "server_misconfigured" };
  const sb = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true, userId: String(data.claims.sub) };
}

export async function canManageTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return true;
  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return m?.role === "owner" || m?.role === "admin";
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const TENANT_RE = /^[0-9a-f-]{36}$/i;
