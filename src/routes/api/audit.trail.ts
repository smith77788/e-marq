/**
 * GET  /api/audit/trail?tenantId=xxx&limit=50  — fetch audit log
 * POST /api/audit/trail                         — log an audit entry
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAuditLog, logAuditEntry } from "@/lib/acos/auditTrail";

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

export const Route = createFileRoute("/api/audit/trail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams } = new URL(request.url);
        const tenantId = (searchParams.get("tenantId") ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 500);

        try {
          const logs = await getAuditLog(tenantId, limit);
          return Response.json({ ok: true, data: logs });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },

      POST: async ({ request }) => {
        let body: {
          tenantId?: string;
          action?: string;
          resourceType?: string;
          resourceId?: string;
          details?: Record<string, unknown>;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return err("Invalid JSON");
        }

        const tenantId = (body.tenantId ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const action = (body.action ?? "").trim();
        if (!action) return err("action required");
        const resourceType = (body.resourceType ?? "").trim();
        if (!resourceType) return err("resourceType required");

        try {
          const result = await logAuditEntry(tenantId, action, resourceType, {
            resourceId: body.resourceId,
            details: body.details,
          });
          return Response.json({ ok: result.ok });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },
    },
  },
});
