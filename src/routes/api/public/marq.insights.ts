/**
 * GET /api/public/marq/insights
 *
 * Brand storefront → ACOS insights for its tenant. Read-only.
 * Auth via API key (tier ≥ public_readonly, scope `insights:read`).
 *
 * Returns at most 50 unread insights, ordered newest first. We strip
 * internal fields (dedup_bucket) and only expose what's safe for a
 * storefront UI banner / owner dashboard widget.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeMarqApiKey, jsonResponse, preflight } from "@/lib/marq-public-api/auth";

const QuerySchema = z.object({
  status: z.enum(["new", "approved", "dismissed", "applied", "all"]).default("new"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  layer: z.string().min(1).max(64).optional(),
});

export const Route = createFileRoute("/api/public/marq/insights")({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        const auth = await authorizeMarqApiKey(request, { scope: "insights:read" });
        if ("error" in auth) return jsonResponse({ error: auth.error }, { status: auth.status });

        const url = new URL(request.url);
        let q: z.infer<typeof QuerySchema>;
        try {
          q = QuerySchema.parse(Object.fromEntries(url.searchParams));
        } catch (err) {
          return jsonResponse(
            { error: err instanceof Error ? err.message : "Invalid query" },
            { status: 400 },
          );
        }

        let query = supabaseAdmin
          .from("ai_insights")
          .select(
            "id, insight_type, title, description, expected_impact, confidence, risk_level, affected_layer, status, created_at, metrics",
          )
          .eq("tenant_id", auth.tenantId)
          .order("created_at", { ascending: false })
          .limit(q.limit);
        if (q.status !== "all") query = query.eq("status", q.status);
        if (q.layer) query = query.eq("affected_layer", q.layer);

        const { data, error } = await query;
        if (error) return jsonResponse({ error: error.message }, { status: 500 });
        return jsonResponse({ insights: data ?? [] });
      },
    },
  },
});
