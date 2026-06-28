/**
 * GET  /api/workflows?tenantId=xxx — список workflows тенанта.
 * POST /api/workflows              — створити workflow.
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWorkflows, createWorkflow } from "@/lib/acos/workflowSystem";

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

const postBodySchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(200),
  trigger: z.string().min(1),
  steps: z.array(
    z.object({
      action: z.string(),
      params: z.record(z.unknown()).optional(),
    }),
  ),
});

export const Route = createFileRoute("/api/workflows")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const workflows = await getWorkflows(tenantId);
        return Response.json({ ok: true, workflows });
      },

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON body");
        }

        const parsed = postBodySchema.safeParse(body);
        if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid body");
        const { tenantId, name, trigger, steps } = parsed.data;

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const workflow = await createWorkflow(tenantId, name, trigger, steps as never);
        return Response.json({ ok: true, workflow });
      },
    },
  },
});
