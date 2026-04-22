/**
 * GET /api/site-builder/download/$buildId
 *
 * Returns a freshly-signed download URL for an existing ready build.
 * Used by the Builds tab to re-download archives after the original
 * link expires (links live 24h, but the row stays).
 *
 * Security: caller must be a member of the build's tenant.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "site-builds";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export const Route = createFileRoute("/api/site-builder/download/$buildId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const buildId = params.buildId;
        if (!buildId || !/^[0-9a-f-]{36}$/i.test(buildId)) {
          return jsonError(400, "Invalid build id");
        }

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) return jsonError(401, "Missing bearer token");
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) return jsonError(401, "Empty bearer token");

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return jsonError(500, "Not configured");

        const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const claims = await userClient.auth.getClaims(token);
        if (claims.error || !claims.data?.claims?.sub) return jsonError(401, "Invalid token");

        const { data: build, error: bErr } = await supabaseAdmin
          .from("site_builds")
          .select("id, tenant_id, status, archive_path")
          .eq("id", buildId)
          .maybeSingle();
        if (bErr) return jsonError(500, bErr.message);
        if (!build) return jsonError(404, "Build not found");

        // Membership check via user-scoped client (RLS-aware).
        const { data: isMember, error: memErr } = await userClient.rpc("is_tenant_member", {
          _tenant_id: build.tenant_id,
        });
        if (memErr) return jsonError(500, memErr.message);
        if (!isMember) return jsonError(403, "Not a member of this tenant");

        if (build.status !== "ready" || !build.archive_path) {
          return jsonError(409, `Build is ${build.status}, not ready`);
        }

        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .createSignedUrl(build.archive_path, SIGNED_URL_TTL_SECONDS, { download: true });
        if (signErr || !signed) return jsonError(500, signErr?.message ?? "Sign failed");

        return Response.json({
          download_url: signed.signedUrl,
          expires_in: SIGNED_URL_TTL_SECONDS,
        });
      },
    },
  },
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
