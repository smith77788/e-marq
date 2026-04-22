/**
 * GET /hooks/integrations/dntrade-webhook-health?tenant=<tenant_id>
 *
 * Health-чек конфігурації DN Trade webhook для конкретного тенанта.
 * Перевіряє:
 *   - наявність інтеграції
 *   - is_active = true
 *   - наявність credentials_encrypted (API key)
 *   - наявність webhook_secret (для верифікації підпису)
 *   - свіжість last_sync_at (warn якщо > 24h)
 *
 * Коди:
 *   200 — все ок (status="healthy") або degraded з warnings.
 *   400 — немає tenant query.
 *   404 — інтеграція не знайдена.
 *   500 — помилка БД.
 *   503 — інтеграція не готова приймати вебхуки (disabled / no key / no secret).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError } from "@/lib/acos/agentRuntime";

const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/hooks/integrations/dntrade-webhook-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenant");
        if (!tenantId) return jsonError("tenant query required", 400);

        const { data: integ, error } = await supabaseAdmin
          .from("tenant_integrations")
          .select(
            "id, is_active, credentials_encrypted, webhook_secret, last_sync_at, last_sync_status, last_sync_error",
          )
          .eq("tenant_id", tenantId)
          .eq("provider", "dntrade")
          .maybeSingle();

        if (error) return jsonError("DB error", 500);
        if (!integ) {
          return jsonStatus(
            {
              status: "missing",
              ready: false,
              checks: { integration_exists: false },
              message: "Інтеграцію DN Trade не налаштовано для цього тенанта.",
            },
            404,
          );
        }

        const checks = {
          integration_exists: true,
          is_active: !!integ.is_active,
          api_key_configured: !!integ.credentials_encrypted,
          webhook_secret_configured: !!integ.webhook_secret,
        };

        const blockers: string[] = [];
        if (!checks.is_active) blockers.push("Інтеграція вимкнена.");
        if (!checks.api_key_configured) blockers.push("Не задано API key.");
        if (!checks.webhook_secret_configured) blockers.push("Не згенеровано webhook_secret.");

        const ready = blockers.length === 0;

        const warnings: string[] = [];
        let lastSyncAgeMs: number | null = null;
        if (integ.last_sync_at) {
          lastSyncAgeMs = Date.now() - new Date(integ.last_sync_at).getTime();
          if (lastSyncAgeMs > STALE_SYNC_MS) {
            warnings.push(
              `Остання синхронізація > ${Math.round(lastSyncAgeMs / 3600000)} год тому.`,
            );
          }
        } else {
          warnings.push("Жодної синхронізації ще не було.");
        }
        if (integ.last_sync_status === "partial") {
          warnings.push("Остання синхронізація завершилась з помилками.");
        }

        const body = {
          status: !ready ? "unhealthy" : warnings.length ? "degraded" : "healthy",
          ready,
          checks,
          blockers,
          warnings,
          last_sync_at: integ.last_sync_at,
          last_sync_status: integ.last_sync_status,
          last_sync_error: integ.last_sync_error,
          last_sync_age_seconds: lastSyncAgeMs == null ? null : Math.round(lastSyncAgeMs / 1000),
        };

        return jsonStatus(body, ready ? 200 : 503);
      },
    },
  },
});
