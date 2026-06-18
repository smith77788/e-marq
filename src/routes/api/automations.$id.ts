/**
 * POST /api/automations/$id — дія над автоматизацією.
 *
 * Body { tenantId, action: "toggle", enabled: boolean } → увімкнути/вимкнути
 * Body { tenantId, action: "run" }                      → запустити вручну
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toggleAutomation, runAutomation } from "@/lib/acos/automationSystem";

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

const ToggleBody = z.object({
  tenantId: z.string().uuid(),
  action: z.literal("toggle"),
  enabled: z.boolean(),
});

const RunBody = z.object({
  tenantId: z.string().uuid(),
  action: z.literal("run"),
});

const Body = z.discriminatedUnion("action", [ToggleBody, RunBody]);

export const Route = createFileRoute("/api/automations/$id" as never)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { id: automationId } = params as unknown as { id: string };
        if (!automationId) return err("Automation ID required");

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

        const tenantId = parsed.data.tenantId;
        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (parsed.data.action === "toggle") {
          const result = await toggleAutomation(tenantId, automationId, parsed.data.enabled);
          return Response.json({ ok: result.ok });
        }

        const result = await runAutomation(tenantId, automationId);
        return Response.json({ ok: result.ok });
      },
    },
  },
});
