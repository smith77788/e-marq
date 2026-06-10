/**
 * POST /hooks/agents/self-heal-dismiss
 * Body: { kind: "incident" | "action", id: string, reason?: string }
 *
 * Lets a super-admin dismiss an incident or a pending action without applying it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/hooks/agents/self-heal-dismiss")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token) return json({ error: "Missing token" }, 401);

        const url = process.env.SUPABASE_URL;
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !anon) return json({ error: "Server not configured" }, 500);

        const sb = createClient<Database>(url, anon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error } = await sb.auth.getClaims(token);
        if (error || !claims?.claims?.sub) return json({ error: "Invalid token" }, 401);
        const userId = claims.claims.sub as string;

        const { data: roles } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin");
        if (!roles || roles.length === 0) return json({ error: "Super-admin required" }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          kind?: "incident" | "action";
          id?: string;
          reason?: string;
        };
        if (!body.kind || !body.id) return json({ error: "Missing kind/id" }, 400);

        if (body.kind === "incident") {
          const { error: rpcErr } = await supabaseAdmin.rpc(
            "self_heal_dismiss_incident" as never,
            { p_incident_id: body.id, p_reason: body.reason ?? null } as never,
          );
          if (rpcErr) return json({ error: rpcErr.message }, 400);
          return json({ ok: true, message: "Incident dismissed" });
        }

        if (body.kind === "action") {
          const { error: rpcErr } = await supabaseAdmin.rpc(
            "self_heal_dismiss_action" as never,
            { p_action_id: body.id, p_reason: body.reason ?? null } as never,
          );
          if (rpcErr) return json({ error: rpcErr.message }, 400);
          return json({ ok: true, message: "Action dismissed" });
        }

        return json({ error: "Invalid kind" }, 400);
      },
    },
  },
});
