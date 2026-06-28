/**
 * GET  /api/scheduler?tenantId=xxx         — список запланованих задач.
 * POST /api/scheduler                      — керування задачами.
 *   Body action="cron":   { tenantId, action, name, cron, handler, payload }
 *   Body action="delay":  { tenantId, action, name, delayMs, handler, payload }
 *   Body action="toggle": { tenantId, action, jobId, enabled }
 *   Body action="delete": { tenantId, action, jobId }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getScheduledJobs,
  scheduleCronJob,
  scheduleDelayedJob,
  toggleScheduledJob,
  deleteScheduledJob,
} from "@/lib/acos/schedulerSystem";

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

export const Route = createFileRoute("/api/scheduler")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const jobs = await getScheduledJobs(tenantId);
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

        if (action === "cron") {
          const { name, cron, handler, payload } = rest as {
            name?: string;
            cron?: string;
            handler?: string;
            payload?: unknown;
          };
          if (!name) return err("name required");
          if (!cron) return err("cron required");
          if (!handler) return err("handler required");
          const result = await scheduleCronJob(tenantId, name, cron, handler, payload);
          if (!result.ok) return err("Failed to schedule cron job", 500);
          return Response.json({ ok: true, id: result.id }, { status: 201 });
        }

        if (action === "delay") {
          const { name, delayMs, handler, payload } = rest as {
            name?: string;
            delayMs?: number;
            handler?: string;
            payload?: unknown;
          };
          if (!name) return err("name required");
          if (delayMs == null) return err("delayMs required");
          if (!handler) return err("handler required");
          const result = await scheduleDelayedJob(tenantId, name, delayMs, handler, payload);
          if (!result.ok) return err("Failed to schedule delayed job", 500);
          return Response.json({ ok: true, id: result.id }, { status: 201 });
        }

        if (action === "toggle") {
          const { jobId, enabled } = rest as { jobId?: string; enabled?: boolean };
          if (!jobId) return err("jobId required");
          if (enabled == null) return err("enabled required");
          const result = await toggleScheduledJob(jobId, enabled);
          return Response.json({ ok: result.ok });
        }

        if (action === "delete") {
          const { jobId } = rest as { jobId?: string };
          if (!jobId) return err("jobId required");
          const result = await deleteScheduledJob(jobId);
          return Response.json({ ok: result.ok });
        }

        return err(`Unknown action: ${action}`);
      },
    },
  },
});
