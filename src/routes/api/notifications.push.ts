/**
 * GET    /api/notifications/push?tenantId=xxx
 * POST   /api/notifications/push
 * DELETE /api/notifications/push
 *
 * Manages browser push notification subscriptions for a tenant.
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getPushSubscriptions,
  registerPushSubscription,
  removePushSubscription,
} from "@/lib/acos/pushSystem";

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

export const Route = createFileRoute("/api/notifications/push")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams } = new URL(request.url);
        const tenantId = (searchParams.get("tenantId") ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const subscriptions = await getPushSubscriptions(tenantId);
        return Response.json({ ok: true, subscriptions });
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

        const subscription = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
        if (!subscription) return err("subscription required");

        const endpoint = (subscription.endpoint ?? "").trim();
        const keys = subscription.keys as { p256dh: string; auth: string } | undefined;

        if (!endpoint) return err("subscription.endpoint required");
        if (!keys?.p256dh || !keys?.auth) return err("subscription.keys.p256dh and .auth required");

        const result = await registerPushSubscription(tenantId, auth.userId, endpoint, keys);
        return Response.json(result);
      },

      DELETE: async ({ request }) => {
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

        const endpoint = ((body.endpoint as string) ?? "").trim();
        if (!endpoint) return err("endpoint required");

        const result = await removePushSubscription(endpoint);
        return Response.json(result);
      },
    },
  },
});
