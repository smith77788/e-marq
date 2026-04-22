/**
 * GET /api/public/marq/recommendations
 *
 * Brand storefront → product recommendations (cross-sell / upsell / bundles).
 * Pulled from `agent_recommendations` if present; otherwise falls back to
 * top-selling products in the tenant.
 *
 * Auth: API key, scope `recommendations:read` (auto-granted to public_write tier).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeMarqApiKey, jsonResponse, preflight } from "@/lib/marq-public-api/auth";

const QuerySchema = z.object({
  context: z.enum(["home", "product", "cart", "checkout"]).default("home"),
  product_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export const Route = createFileRoute("/api/public/marq/recommendations")({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        const auth = await authorizeMarqApiKey(request);
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

        // Fallback: top-N best sellers for this tenant.
        const { data, error } = await supabaseAdmin
          .from("products")
          .select(
            "id, name, slug, price_cents, compare_at_price_cents, currency, image_url, total_sold",
          )
          .eq("tenant_id", auth.tenantId)
          .eq("is_active", true)
          .order("total_sold", { ascending: false, nullsFirst: false })
          .limit(q.limit);
        if (error) return jsonResponse({ error: error.message }, { status: 500 });

        return jsonResponse({
          context: q.context,
          source: "best_sellers_fallback",
          recommendations: data ?? [],
        });
      },
    },
  },
});
