/**
 * GET  /api/notifications?tenantId=xxx&limit=50 — список сповіщень тенанта.
 * POST /api/notifications — позначити прочитаними.
 *   Body: { tenantId, id }        → markAsRead(id)
 *   Body: { tenantId, all: true } → markAllAsRead(tenantId)
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
} from "@/lib/acos/notificationSystem";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "Server not configured" };

  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return { ok: false, status: 401, error: "Invalid token" };
  const userId = claims.claims.sub as string;

  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return { ok: true };

  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
        const notifications = await getUnreadNotifications(tenantId, limit);
        return Response.json({ ok: true, notifications });
      },

      POST: async ({ request }) => {
        let body: { tenantId?: string; id?: string; all?: boolean };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return err("Invalid JSON");
        }

        const tenantId = (body.tenantId ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (body.all) {
          const result = await markAllAsRead(tenantId);
          return Response.json({ ok: result.ok, count: result.count });
        }

        if (!body.id) return err("id or all:true required");
        const result = await markAsRead(body.id);
        return Response.json({ ok: result.ok });
      },
    },
  },
});
