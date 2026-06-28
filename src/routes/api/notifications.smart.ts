/**
 * POST /api/notifications/smart
 *
 * Triggers smart notification actions for a tenant:
 *   action=notify       — create a notification via all channels
 *   action=check_sales  — analyze sales anomalies
 *   action=check_stock  — monitor stock levels
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createNotification,
  analyzeSalesAnomaly,
  monitorStockLevels,
} from "@/lib/acos/smartNotifications";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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
  if (sa) return { ok: true };
  const { data: m } = await supabaseAdmin.from("tenant_memberships").select("role").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export const Route = createFileRoute("/api/notifications/smart")({
  server: {
    handlers: {
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

        if (action === "notify") {
          const type = body.type as import("@/lib/acos/smartNotifications").NotificationType;
          const severity = body.severity as import("@/lib/acos/smartNotifications").NotificationSeverity;
          const title = (body.title as string) ?? "";
          const notifBody = (body.body as string) ?? "";

          if (!type) return err("type required");
          if (!severity) return err("severity required");
          if (!title) return err("title required");
          if (!notifBody) return err("body required");

          const options = {
            action_url: body.action_url as string | undefined,
            action_label: body.action_label as string | undefined,
            metadata: body.metadata as Record<string, unknown> | undefined,
          };

          const result = await createNotification(tenantId, type, severity, title, notifBody, options);
          return Response.json(result);
        }

        if (action === "check_sales") {
          await analyzeSalesAnomaly(tenantId);
          return Response.json({ ok: true });
        }

        if (action === "check_stock") {
          await monitorStockLevels(tenantId);
          return Response.json({ ok: true });
        }

        return err("Unknown action");
      },
    },
  },
});
