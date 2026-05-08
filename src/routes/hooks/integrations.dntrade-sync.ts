/**
 * POST /hooks/integrations/dntrade-sync
 *
 * Запускає синхронізацію DN Trade ↔ нашого tenant.
 * Body: { tenant_id: string, kinds?: ("products"|"customers"|"orders")[], full?: boolean }
 *
 * Авторизація: bearer token = SUPABASE_PUBLISHABLE_KEY (cron) АБО JWT super-admin / member тенанта.
 *
 * `full=true` ігнорує last_sync_at і тягне всі дані (для першої синхронізації).
 * Інакше — інкрементально від `last_sync_at`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { runFullDnTradeSync } from "@/lib/dntrade/sync";
import { verifyApiKey } from "@/lib/dntrade/client";

export const Route = createFileRoute("/hooks/integrations/dntrade-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();

        let body: { tenant_id?: string; kinds?: string[]; full?: boolean };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        const tenantId = body.tenant_id;
        if (!tenantId) return jsonError("tenant_id required", 400);

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
            "Бренд ще не верифіковано адміністратором. Синхронізація стане доступною після підтвердження.",
            403,
          );
        }

        // Load integration row
        const { data: integ, error: loadErr } = await supabaseAdmin
          .from("tenant_integrations")
          .select("id, credentials_encrypted, last_sync_at, is_active")
          .eq("tenant_id", tenantId)
          .eq("provider", "dntrade")
          .maybeSingle();

        if (loadErr) return jsonError(`DB error: ${loadErr.message}`, 500);
        if (!integ) return jsonError("DN Trade integration not configured for this tenant", 404);
        if (!integ.is_active) return jsonError("Integration is disabled", 409);
        if (!integ.credentials_encrypted) return jsonError("Missing API key", 409);

        const apiKey = integ.credentials_encrypted;
        const kinds = (
          body.kinds && body.kinds.length > 0 ? body.kinds : ["products", "customers", "orders"]
        ).filter((k): k is "products" | "customers" | "orders" =>
          ["products", "customers", "orders"].includes(k),
        );
        const modifiedFromIso = body.full === true ? undefined : (integ.last_sync_at ?? undefined);

        // Mark started
        await supabaseAdmin
          .from("tenant_integrations")
          .update({ last_sync_status: "running", last_sync_error: null })
          .eq("id", integ.id);

        try {
          const summary = await runFullDnTradeSync(supabaseAdmin, tenantId, apiKey, {
            kinds,
            modifiedFromIso,
            integrationId: integ.id,
            maxPages: body.full === true ? 10 : 5,
            requestTimeoutMs: 6_000,
          });

          const totalProducts = summary.products.upserted;
          const totalCustomers = summary.customers.upserted;
          const totalOrders = summary.orders.inserted;
          const hasErrors = summary.errors.length > 0 || summary.mapping_errors.length > 0;

          await supabaseAdmin
            .from("tenant_integrations")
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: hasErrors ? "partial" : "success",
              last_sync_error: hasErrors
                ? [
                    ...summary.errors,
                    ...summary.mapping_errors
                      .slice(0, 3)
                      .map((e) => `${e.kind}#${e.external_id ?? "?"}: ${e.message}`),
                  ].join(" | ")
                : null,
              synced_products_count: totalProducts,
              synced_customers_count: totalCustomers,
              synced_orders_count: totalOrders,
            })
            .eq("id", integ.id);

          return jsonOk({ summary });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await supabaseAdmin
            .from("tenant_integrations")
            .update({
              last_sync_status: "failed",
              last_sync_error: message,
            })
            .eq("id", integ.id);
          return jsonError(message, 500);
        }
      },
    },
  },
});

// Re-export for convenience in case future tests want it
export { verifyApiKey };
