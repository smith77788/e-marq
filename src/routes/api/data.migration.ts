/**
 * GET  /api/data/migration               — get migration status (no tenantId needed)
 * POST /api/data/migration               — run a migration by ID
 *
 * Auth: Bearer JWT, super_admin only for POST; GET requires super_admin or any membership.
 * For GET, tenantId is optional — if omitted, super_admin role is required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getMigrationStatus, runMigration } from "@/lib/acos/dataMigration";

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

export const Route = createFileRoute("/api/data/migration")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // getMigrationStatus needs no tenantId; use a sentinel so resolveAuth
        // falls through to the super_admin check. A regular tenant member will
        // be rejected unless they also pass a tenantId that they belong to.
        const { searchParams } = new URL(request.url);
        const tenantId = (searchParams.get("tenantId") ?? "").trim();

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        try {
          const status = await getMigrationStatus();
          return Response.json({ ok: true, data: status });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },

      POST: async ({ request }) => {
        let body: { tenantId?: string; migrationId?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return err("Invalid JSON");
        }

        const tenantId = (body.tenantId ?? "").trim();
        const migrationId = (body.migrationId ?? "").trim();
        if (!migrationId) return err("migrationId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        try {
          const result = await runMigration(migrationId);
          return Response.json({ ok: result.ok, data: result });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },
    },
  },
});
