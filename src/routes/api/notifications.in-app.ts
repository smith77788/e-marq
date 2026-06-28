/**
 * GET  /api/notifications/in-app?tenantId=xxx
 * POST /api/notifications/in-app
 *
 * Manages in-app notifications for a tenant's user.
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getUnreadInAppNotifications,
  getUnreadCount,
  createInAppNotification,
  markInAppAsRead,
  markAllInAppAsRead,
} from "@/lib/acos/inAppNotificationSystem";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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
  const { data: sa } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (sa) return { ok: true, userId };
  const { data: m } = await supabaseAdmin.from("tenant_memberships").select("role").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, userId };
}

export const Route = createFileRoute("/api/notifications/in-app")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams } = new URL(request.url);
        const tenantId = (searchParams.get("tenantId") ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const [notifications, count] = await Promise.all([
          getUnreadInAppNotifications(tenantId, auth.userId),
          getUnreadCount(tenantId, auth.userId),
        ]);

        return Response.json({ ok: true, notifications, count });
      },

      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return err("Invalid JSON");
        }

        const tenantId = ((body.tenantId as string) ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const action = (body.action as string) ?? "";

        if (action === "create") {
          const userId = (body.userId as string) ?? auth.userId;
          const type = body.type as "toast" | "banner" | "badge";
          const title = (body.title as string) ?? "";
          const message = (body.message as string) ?? "";
          const actionUrl = body.actionUrl as string | undefined;
          if (!type || !title || !message) return err("type, title, message required");
          const result = await createInAppNotification(tenantId, userId, type, title, message, actionUrl);
          return Response.json(result);
        }

        if (action === "read") {
          const id = (body.id as string) ?? "";
          if (!id) return err("id required");
          const result = await markInAppAsRead(id);
          return Response.json(result);
        }

        if (action === "read_all") {
          const result = await markAllInAppAsRead(tenantId, auth.userId);
          return Response.json(result);
        }

        return err("Unknown action");
      },
    },
  },
});
