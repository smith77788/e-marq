/**
 * POST /hooks/integrations/dntrade-dry-run
 *
 * Тестовий запуск: тягне дані з DN Trade, мапить, але НЕ пише в БД.
 * Повертає sample (до 5 записів кожного типу) + всі mapping errors.
 *
 * Body: { tenant_id: string, kinds?: ("products"|"customers"|"orders")[] }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { runFullDnTradeSync } from "@/lib/dntrade/sync";

export const Route = createFileRoute("/hooks/integrations/dntrade-dry-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();

        let body: { tenant_id?: string; kinds?: string[] };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        const tenantId = body.tenant_id;
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const { data: integ, error: loadErr } = await supabaseAdmin
          .from("tenant_integrations")
          .select("id, credentials_encrypted, is_active")
          .eq("tenant_id", tenantId)
          .eq("provider", "dntrade")
          .maybeSingle();

        if (loadErr) return jsonError(`DB error: ${loadErr.message}`, 500);
        if (!integ?.credentials_encrypted) return jsonError("DN Trade not configured", 404);
        if (!integ.is_active) return jsonError("Integration disabled", 409);

        const kinds = (body.kinds && body.kinds.length > 0
          ? body.kinds
          : ["products", "customers", "orders"]
        ).filter((k): k is "products" | "customers" | "orders" =>
          ["products", "customers", "orders"].includes(k),
        );

        try {
          const summary = await runFullDnTradeSync(
            supabaseAdmin,
            tenantId,
            integ.credentials_encrypted,
            { kinds, dryRun: true },
          );
          return jsonOk({ dry_run: true, summary });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e), 500);
        }
      },
    },
  },
});
