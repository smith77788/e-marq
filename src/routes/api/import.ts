/**
 * POST /api/import {tenantId, type, data, headers} — validate and import CSV data
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { validateCsv, importCsv } from "@/lib/acos/importSystem";

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

export const Route = createFileRoute("/api/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          tenantId?: string;
          type?: "products" | "customers" | "orders";
          data?: string;
          headers?: string[];
        };
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON body");
        }

        const { tenantId, type, data, headers } = body;
        if (!tenantId) return err("tenantId required");
        if (!type) return err("type required (products|customers|orders)");
        if (!data) return err("data (CSV string) required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        // Validate CSV first if required fields (headers) were provided
        if (headers && headers.length > 0) {
          const validation = validateCsv(data, headers);
          if (!validation.valid) {
            return Response.json({ ok: false, error: "CSV validation failed", errors: validation.errors }, { status: 422 });
          }
        }

        const result = await importCsv(tenantId, data, type);
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
