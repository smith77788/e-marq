/**
 * POST /hooks/integrations/dntrade-verify
 *
 * Перевіряє ApiKey DN Trade без збереження. UI кличе перед тим, як показати "успішно".
 * Body: { tenant_id: string, api_key: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyApiKey } from "@/lib/dntrade/client";

export const Route = createFileRoute("/hooks/integrations/dntrade-verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();

        let body: { tenant_id?: string; api_key?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        const tenantId = body.tenant_id;
        const apiKey = body.api_key?.trim();
        if (!tenantId) return jsonError("tenant_id required", 400);
        if (!apiKey) return jsonError("api_key required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        // Guard: tenant must be active
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("status")
          .eq("id", tenantId)
          .maybeSingle();
        if (tenant && tenant.status !== "active") {
          return jsonError(
            "Бренд ще не верифіковано адміністратором. Підключення стане доступним після підтвердження.",
            403,
          );
        }

        const result = await verifyApiKey(apiKey);
        if (result.ok) return jsonOk({ valid: true });
        return jsonOk({
          valid: false,
          status: result.status,
          message: `DN Trade відхилив ключ (HTTP ${result.status}). Перевірте, що це ApiKey з правами читання.`,
        });
      },
    },
  },
});
