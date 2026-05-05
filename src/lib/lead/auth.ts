/**
 * Спрощена авторизація для lead-агентів: cron (anon key) або супер-адмін.
 * На відміну від tenant-агентів, тут не потрібен tenant_id.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { isCronToken } from "@/lib/acos/cronAuth";

export async function authorizeLeadAgent(
  request: Request,
): Promise<{ kind: "cron" | "super" } | { error: string; status: number }> {
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
  if ((roles ?? []).length === 0) return { error: "Forbidden", status: 403 };
  return { kind: "super" };
}
