/**
 * GET  /api/team?tenantId=xxx — get team tasks.
 * POST /api/team — create task, update task status, or add insight comment.
 *
 * POST body variants:
 *   { tenantId, action: "create", title, description?, assigned_to?, status?, priority?, due_date?, created_by }
 *   { tenantId, action: "update", taskId, status }
 *   { tenantId, action: "comment", insightId, userId, comment }
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getTeamTasks,
  createTask,
  updateTaskStatus,
  addInsightComment,
  type TeamTask,
} from "@/lib/acos/teamCollaboration";

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

export const Route = createFileRoute("/api/team")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const tasks = await getTeamTasks(tenantId);
        return Response.json({ ok: true, tasks });
      },

      POST: async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const tenantId = (body.tenantId as string) ?? "";
        const action = (body.action as string) ?? "";
        if (!tenantId) return err("tenantId required");
        if (!action) return err("action required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        if (action === "create") {
          const title = (body.title as string) ?? "";
          const createdBy = (body.created_by as string) ?? "";
          if (!title) return err("title required");
          if (!createdBy) return err("created_by required");

          const taskPayload: Omit<TeamTask, "id" | "tenant_id" | "created_at"> = {
            title,
            description: body.description as string | undefined,
            assigned_to: body.assigned_to as string | undefined,
            status: (body.status as TeamTask["status"]) ?? "todo",
            priority: (body.priority as TeamTask["priority"]) ?? "medium",
            due_date: body.due_date as string | undefined,
            created_by: createdBy,
          };

          const task = await createTask(tenantId, taskPayload);
          return Response.json({ ok: true, task });
        }

        if (action === "update") {
          const taskId = (body.taskId as string) ?? "";
          const status = body.status as TeamTask["status"];
          if (!taskId) return err("taskId required");
          if (!status) return err("status required");

          const result = await updateTaskStatus(taskId, status);
          return Response.json({ ok: true, ...result });
        }

        if (action === "comment") {
          const insightId = (body.insightId as string) ?? "";
          const userId = (body.userId as string) ?? "";
          const comment = (body.comment as string) ?? "";
          if (!insightId) return err("insightId required");
          if (!userId) return err("userId required");
          if (!comment) return err("comment required");

          const result = await addInsightComment(tenantId, insightId, userId, comment);
          return Response.json({ ok: true, ...result });
        }

        return err(`Unknown action: ${action}`);
      },
    },
  },
});
