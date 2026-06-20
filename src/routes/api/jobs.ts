/**
 * GET  /api/jobs?tenantId=xxx&status=xxx    — список задач тенанта.
 * POST /api/jobs                            — керування задачами.
 *   Body action="create":   { tenantId, action, type, payload }
 *   Body action="start":    { tenantId, action, jobId }
 *   Body action="complete": { tenantId, action, jobId, result }
 *   Body action="fail":     { tenantId, action, jobId, error }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getJobs, createJob, startJob, completeJob, failJob } from "@/lib/acos/jobSystem";

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

export const Route = createFileRoute("/api/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        const status = url.searchParams.get("status") ?? undefined;
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const jobs = await getJobs(tenantId, status);
        return Response.json({ ok: true, jobs });
      },

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON");
        }

        const { tenantId, action, ...rest } = body as {
          tenantId?: string;
          action?: string;
          [key: string]: unknown;
        };
        if (!tenantId) return err("tenantId required");
        if (!action) return err("action required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (action === "create") {
          const { type, payload } = rest as { type?: string; payload?: unknown };
          if (!type) return err("type required");
          const result = await createJob(tenantId, type, payload);
          if (!result.ok) return err("Failed to create job", 500);
          return Response.json({ ok: true, id: result.id }, { status: 201 });
        }

        if (action === "start") {
          const { jobId } = rest as { jobId?: string };
          if (!jobId) return err("jobId required");
          const result = await startJob(jobId);
          return Response.json({ ok: result.ok });
        }

        if (action === "complete") {
          const { jobId, result: jobResult } = rest as { jobId?: string; result?: unknown };
          if (!jobId) return err("jobId required");
          const result = await completeJob(jobId, jobResult);
          return Response.json({ ok: result.ok });
        }

        if (action === "fail") {
          const { jobId, error: jobError } = rest as { jobId?: string; error?: string };
          if (!jobId) return err("jobId required");
          if (!jobError) return err("error required");
          const result = await failJob(jobId, jobError);
          return Response.json({ ok: result.ok });
        }

        return err(`Unknown action: ${action}`);
      },
    },
  },
});
