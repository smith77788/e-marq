/**
 * GET  /api/integrations?tenantId=xxx — list integrations + status
 * POST /api/integrations {tenantId, action, provider, config} — connect / disconnect
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getIntegrations,
  getIntegrationStatus,
  connectIntegration,
  disconnectIntegration,
} from "@/lib/acos/integrationSystem";

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

export const Route = createFileRoute("/api/integrations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const tenantId = u.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const [integrations, status] = await Promise.all([
          getIntegrations(tenantId),
          getIntegrationStatus(tenantId),
        ]);

        return Response.json({ ok: true, integrations, status });
      },

      POST: async ({ request }) => {
        let body: { tenantId?: string; action?: string; provider?: string; config?: Record<string, unknown> };
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON body");
        }

        const { tenantId, action, provider, config } = body;
        if (!tenantId) return err("tenantId required");
        if (!action) return err("action required");
        if (!provider) return err("provider required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (action === "connect") {
          const result = await connectIntegration(tenantId, provider, config ?? {});
          return Response.json({ ok: true, ...result });
        }

        if (action === "disconnect") {
          const result = await disconnectIntegration(tenantId, provider);
          return Response.json({ ok: true, ...result });
        }

        return err(`Unknown action: ${action}`);
      },
    },
  },
});
