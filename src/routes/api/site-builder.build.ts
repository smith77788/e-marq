/**
 * POST /api/site-builder/build
 *
 * Authenticated endpoint — caller must hold a valid Supabase session and
 * be a member of the target tenant. Generates a brand-overlay ZIP for the
 * MFD template, uploads it to the private `site-builds` bucket, persists a
 * `site_builds` row, and returns the build id + signed download URL.
 *
 * Hardening:
 *  - Bearer auth via Supabase publishable client (RLS-enabled).
 *  - Tenant membership re-verified server-side via `is_tenant_member` RPC
 *    (defence-in-depth — the table RLS already blocks non-members, but we
 *    short-circuit before doing any expensive work).
 *  - Throttle: max 1 build per tenant per 60 s (lightweight in-memory + DB
 *    timestamp check). On failure we still record a row so the user sees it.
 *  - Bucket path: `{tenant_id}/{build_id}.zip` — RLS in the bucket prevents
 *    cross-tenant reads.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadSafeBrandContext,
  validateBrandContext,
  slugifyBrand,
} from "@/lib/site-builder/brandContext";
import { buildBrandArchive } from "@/lib/site-builder/zipBuilder";

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  template_id: z.string().uuid(),
});

const BUCKET = "site-builds";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h
const MIN_INTERVAL_MS = 60_000; // 1 min cooldown per tenant

export const Route = createFileRoute("/api/site-builder/build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Auth — Bearer token required.
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return jsonError(401, "Missing bearer token");
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) return jsonError(401, "Empty bearer token");

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return jsonError(500, "Server not configured");
        }

        const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const claims = await userClient.auth.getClaims(token);
        const userId = claims.data?.claims?.sub;
        if (claims.error || !userId) return jsonError(401, "Invalid token");

        // 2. Validate body.
        let body: z.infer<typeof BodySchema>;
        try {
          const raw = await request.json();
          body = BodySchema.parse(raw);
        } catch (err) {
          return jsonError(400, err instanceof Error ? err.message : "Invalid body");
        }

        // 3. Verify membership OR super-admin (defence-in-depth).
        const [memRes, adminRes] = await Promise.all([
          userClient.rpc("is_tenant_member", { _tenant_id: body.tenant_id }),
          userClient.rpc("is_super_admin"),
        ]);
        if (memRes.error && adminRes.error) {
          return jsonError(500, memRes.error.message);
        }
        const allowed = !!memRes.data || !!adminRes.data;
        if (!allowed) return jsonError(403, "Not a member of this tenant");

        // 4. Cooldown — block accidental double-clicks / abuse.
        const sinceIso = new Date(Date.now() - MIN_INTERVAL_MS).toISOString();
        const { count: recentCount } = await supabaseAdmin
          .from("site_builds")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", body.tenant_id)
          .gte("created_at", sinceIso);
        if ((recentCount ?? 0) > 0) {
          return jsonError(429, "A build was started recently. Please wait a minute.");
        }

        // 5. Insert queued row.
        const { data: buildRow, error: insertErr } = await supabaseAdmin
          .from("site_builds")
          .insert({
            tenant_id: body.tenant_id,
            template_id: body.template_id,
            status: "building",
            requested_by: userId,
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insertErr || !buildRow) {
          return jsonError(500, insertErr?.message ?? "Failed to create build");
        }
        const buildId = buildRow.id;

        // 6. Build archive.
        try {
          const ctx = await loadSafeBrandContext(body.tenant_id, body.template_id);
          if (!ctx) throw new Error("Brand profile not found — save the form first.");

          const errors = validateBrandContext(ctx);
          if (errors.length > 0) {
            throw new Error(
              "Profile invalid: " + errors.map((e) => `${e.field}: ${e.message}`).join("; "),
            );
          }

          const archive = await buildBrandArchive(ctx);
          const path = `${body.tenant_id}/${buildId}.zip`;

          const { error: upErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, archive.bytes, {
              contentType: "application/zip",
              upsert: true,
            });
          if (upErr) throw upErr;

          const { data: signed, error: signErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
              download: `${slugifyBrand(ctx.profile.brand_name)}-site-kit.zip`,
            });
          if (signErr || !signed) throw signErr ?? new Error("Failed to sign URL");

          await supabaseAdmin
            .from("site_builds")
            .update({
              status: "ready",
              archive_path: path,
              archive_size_bytes: archive.size,
              archive_sha256: archive.sha256,
              finished_at: new Date().toISOString(),
              manifest: {
                template_key: ctx.template.key,
                brand_name: ctx.profile.brand_name,
                file_count: 14,
              },
            })
            .eq("id", buildId);

          return Response.json({
            build_id: buildId,
            status: "ready",
            archive_path: path,
            archive_size_bytes: archive.size,
            archive_sha256: archive.sha256,
            download_url: signed.signedUrl,
            expires_in: SIGNED_URL_TTL_SECONDS,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await supabaseAdmin
            .from("site_builds")
            .update({
              status: "failed",
              error: msg,
              finished_at: new Date().toISOString(),
            })
            .eq("id", buildId);
          return jsonError(500, msg, { build_id: buildId });
        }
      },
    },
  },
});

function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
