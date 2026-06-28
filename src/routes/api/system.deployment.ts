/**
 * GET  /api/system/deployment?tenantId=xxx  — активний деплой + історія.
 * POST /api/system/deployment               — створити деплой.
 *   Body: { tenantId, version, config? }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getActiveDeployment,
  getDeploymentHistory,
  createDeployment,
} from "@/lib/acos/deploymentSystem";

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

export const Route = createFileRoute("/api/system/deployment")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const [active, history] = await Promise.all([
          getActiveDeployment(tenantId),
          getDeploymentHistory(tenantId),
        ]);
        return Response.json({ ok: true, active, history });
      },

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON");
        }

        const { tenantId, version, config } = body as {
          tenantId?: string;
          version?: string;
          config?: string;
        };
        if (!tenantId) return err("tenantId required");
        if (!version) return err("version required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        // createDeployment(tenantId, version, environment) — config maps to environment
        const result = await createDeployment(tenantId, version, config);
        if (!result.ok) return err("Failed to create deployment", 500);
        return Response.json({ ok: true, id: result.id }, { status: 201 });
      },
    },
  },
});
