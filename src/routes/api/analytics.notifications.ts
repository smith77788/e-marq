/**
 * POST /api/analytics/notifications
 *
 * Sends analytics-driven notifications for a tenant:
 *   type=insight — notify about an analytics insight
 *   type=goal    — notify that a goal has been achieved
 *   type=problem — notify about a detected problem
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  notifyInsight,
  notifyGoalAchieved,
  notifyProblem,
} from "@/lib/acos/analyticsNotifications";

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

export const Route = createFileRoute("/api/analytics/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return err("Invalid JSON");
        }

        const tenantId = ((body.tenantId as string) ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const type = (body.type as string) ?? "";

        if (type === "insight") {
          const insight = body.insight as { insightType?: string; title?: string; body?: string } | undefined;
          const insightType = (insight?.insightType ?? (body.insightType as string) ?? "").trim();
          const title = (insight?.title ?? (body.title as string) ?? "").trim();
          const insightBody = (insight?.body ?? (body.body as string) ?? "").trim();

          if (!insightType) return err("insight.insightType required");
          if (!title) return err("insight.title required");
          if (!insightBody) return err("insight.body required");

          const result = await notifyInsight(tenantId, insightType, title, insightBody);
          return Response.json(result);
        }

        if (type === "goal") {
          const goal = body.goal as { goal?: string; value?: number } | undefined;
          const goalName = ((goal?.goal ?? (body.goalName as string)) ?? "").trim();
          const value = (goal?.value ?? (body.value as number)) ?? 0;

          if (!goalName) return err("goal.goal required");

          const result = await notifyGoalAchieved(tenantId, goalName, value);
          return Response.json(result);
        }

        if (type === "problem") {
          const problem = body.problem as { problem?: string; details?: string } | undefined;
          const problemName = ((problem?.problem ?? (body.problemName as string)) ?? "").trim();
          const details = ((problem?.details ?? (body.details as string)) ?? "").trim();

          if (!problemName) return err("problem.problem required");

          const result = await notifyProblem(tenantId, problemName, details);
          return Response.json(result);
        }

        return err("Unknown type");
      },
    },
  },
});
