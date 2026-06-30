/**
 * GET  /api/sync?tenantId=xxx — get sync history
 * POST /api/sync {tenantId, type} — start a sync job
 * POST /api/sync {syncId, result} — complete a sync job
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSyncHistory, startSync, completeSync } from "@/lib/acos/syncSystem";

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

export const Route = createFileRoute("/api/sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const tenantId = u.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const history = await getSyncHistory(tenantId);
        return Response.json({ ok: true, history });
      },

      POST: async ({ request }) => {
        let body: { tenantId?: string; type?: string; syncId?: string; result?: { itemsSynced?: number; errors?: number } };
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON body");
        }

        // Complete a sync job: {syncId, result}
        if (body.syncId) {
          const { syncId, result } = body;
          const itemsSynced = result?.itemsSynced ?? 0;
          const errors = result?.errors ?? 0;
          const res = await completeSync(syncId, itemsSynced, errors);
          return Response.json({ ...res, ok: true });
        }

        // Start a new sync job: {tenantId, type}
        const { tenantId, type } = body;
        if (!tenantId) return err("tenantId required");
        if (!type) return err("type required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const job = await startSync(tenantId, type);
        return Response.json({ ok: true, syncId: job.id, job });
      },
    },
  },
});
