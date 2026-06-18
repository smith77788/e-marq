/**
 * GET  /api/incidents?tenantId=xxx         — відкриті інциденти тенанта.
 * POST /api/incidents                       — створити або оновити інцидент.
 *   Body create: { tenantId, action: "create", title, description, severity }
 *   Body update: { tenantId, action: "update_status", incidentId, status }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createIncident,
  updateIncidentStatus,
  getOpenIncidents,
} from "@/lib/acos/incidentManagementSystem";

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

const CreateBody = z.object({
  tenantId: z.string().uuid(),
  action: z.literal("create"),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(2000),
  severity: z.enum(["low", "medium", "high", "critical"]),
});

const UpdateBody = z.object({
  tenantId: z.string().uuid(),
  action: z.literal("update_status"),
  incidentId: z.string().uuid(),
  status: z.enum(["open", "investigating", "identified", "monitoring", "resolved"]),
});

const Body = z.discriminatedUnion("action", [CreateBody, UpdateBody]);

export const Route = createFileRoute("/api/incidents" as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const incidents = await getOpenIncidents(tenantId);
        return Response.json({ ok: true, incidents });
      },

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON");
        }

        const parsed = Body.safeParse(body);
        if (!parsed.success) {
          return err(JSON.stringify(parsed.error.flatten().fieldErrors), 400);
        }

        const auth = await resolveAuth(request, parsed.data.tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (parsed.data.action === "create") {
          const { tenantId, title, description, severity } = parsed.data;
          const result = await createIncident(tenantId, title, description, severity);
          if (!result.ok) return err("Failed to create incident", 500);
          return Response.json({ ok: true, id: result.id }, { status: 201 });
        }

        const result = await updateIncidentStatus(parsed.data.incidentId, parsed.data.status);
        return Response.json({ ok: result.ok });
      },
    },
  },
});
