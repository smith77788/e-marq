/**
 * POST /hooks/agents/self-heal-revert
 * Body: { action_id: string }
 *
 * Reverts a previously-applied self-heal action. Super-admin only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { revertAppliedAction } from "@/lib/self-heal/engine";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/hooks/agents/self-heal-revert")({
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

        const body = (await request.json().catch(() => ({}))) as { action_id?: string };
        if (!body.action_id) return json({ error: "Missing action_id" }, 400);

        const res = await revertAppliedAction(body.action_id, userId);
        return json(
          { ok: res.ok, message: res.message, affected: res.affected },
          res.ok ? 200 : 400,
        );
      },
    },
  },
});
