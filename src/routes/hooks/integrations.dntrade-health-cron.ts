/**
 * POST /hooks/integrations/dntrade-health-cron
 *
 * Щогодинний моніторинг DN Trade-інтеграцій. Для кожного активного tenant_integration:
 *   1. Викликає внутрішню health-логіку (та сама, що /dntrade-webhook-health).
 *   2. Записує snapshot у `dntrade_health_log`.
 *   3. Якщо degraded/unhealthy — додає row у `dntrade_sync_errors` (kind="health").
 *   4. Створює owner_notifications, якщо:
 *        - tenant unhealthy безперервно >= ALERT_UNHEALTHY_MIN хвилин;
 *        - або partial-синків >= ALERT_PARTIAL_THRESHOLD за ALERT_PARTIAL_WINDOW_HOURS.
 *      Дедуп: одна нотифікація на тип на 24 години.
 *
 * Авторизація: Bearer SUPABASE_PUBLISHABLE_KEY (cron-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";

const ALERT_UNHEALTHY_MIN = 30;
const ALERT_PARTIAL_THRESHOLD = 3;
const ALERT_PARTIAL_WINDOW_HOURS = 6;
const STALE_SYNC_MS = 24 * 60 * 60 * 1000;
const ALERT_DEDUP_MS = 24 * 60 * 60 * 1000;

type IntegRow = {
  id: string;
  tenant_id: string;
  is_active: boolean;
  credentials_encrypted: string | null;
  webhook_secret: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

type HealthResult = {
  status: "healthy" | "degraded" | "unhealthy" | "missing" | "error";
  http_status: number;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  last_sync_status: string | null;
  last_sync_age_seconds: number | null;
};

function evaluateHealth(integ: IntegRow): HealthResult {
  const checks = {
    is_active: !!integ.is_active,
    api_key_configured: !!integ.credentials_encrypted,
    webhook_secret_configured: !!integ.webhook_secret,
  };
  const blockers: string[] = [];
  if (!checks.is_active) blockers.push("Інтеграція вимкнена.");
  if (!checks.api_key_configured) blockers.push("Не задано API key.");
  if (!checks.webhook_secret_configured)
    blockers.push("Не згенеровано webhook_secret.");

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

  const status: HealthResult["status"] = !ready
    ? "unhealthy"
    : warnings.length
      ? "degraded"
      : "healthy";

  return {
    status,
    http_status: ready ? 200 : 503,
    ready,
    blockers,
    warnings,
    last_sync_status: integ.last_sync_status,
    last_sync_age_seconds:
      lastSyncAgeMs == null ? null : Math.round(lastSyncAgeMs / 1000),
  };
}

/** Перевірити, чи вже є свіжа алерт-нотифікація. */
async function hasRecentAlert(
  tenantId: string,
  kind: string,
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUP_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("owner_notifications")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .gte("created_at", since)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export const Route = createFileRoute(
  "/hooks/integrations/dntrade-health-cron",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token || token !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return jsonError("Unauthorized", 401);
        }

        const { data: integrations, error } = await supabaseAdmin
          .from("tenant_integrations")
          .select(
            "id, tenant_id, is_active, credentials_encrypted, webhook_secret, last_sync_at, last_sync_status, last_sync_error",
          )
          .eq("provider", "dntrade");
        if (error) return jsonError(error.message, 500);

        const results: Array<{
          tenant_id: string;
          status: HealthResult["status"];
          alerted: boolean;
        }> = [];

        for (const integ of (integrations ?? []) as IntegRow[]) {
          const h = evaluateHealth(integ);

          // 1. Snapshot у health_log.
          await supabaseAdmin.from("dntrade_health_log").insert({
            tenant_id: integ.tenant_id,
            integration_id: integ.id,
            status: h.status,
            http_status: h.http_status,
            ready: h.ready,
            blockers: h.blockers as never,
            warnings: h.warnings as never,
            last_sync_status: h.last_sync_status,
            last_sync_age_seconds: h.last_sync_age_seconds,
          });

          // 2. Лог у dntrade_sync_errors для degraded/unhealthy.
          if (h.status === "unhealthy" || h.status === "degraded") {
            await supabaseAdmin.from("dntrade_sync_errors").insert({
              tenant_id: integ.tenant_id,
              integration_id: integ.id,
              kind: "health",
              message: [...h.blockers, ...h.warnings].join(" | ") || h.status,
              raw: {
                status: h.status,
                blockers: h.blockers,
                warnings: h.warnings,
                last_sync_status: h.last_sync_status,
              } as never,
            });
          }

          // 3. Алерти.
          let alerted = false;

          // 3a. Тривалий unhealthy.
          if (h.status === "unhealthy" || h.status === "missing") {
            const { data: streakRows } = await supabaseAdmin.rpc(
              "dntrade_unhealthy_streak_minutes",
              { _tenant_id: integ.tenant_id },
            );
            const streak =
              typeof streakRows === "number" ? streakRows : Number(streakRows ?? 0);
            if (streak >= ALERT_UNHEALTHY_MIN) {
              const recent = await hasRecentAlert(
                integ.tenant_id,
                "dntrade_unhealthy",
              );
              if (!recent) {
                await supabaseAdmin.from("owner_notifications").insert({
                  tenant_id: integ.tenant_id,
                  kind: "dntrade_unhealthy",
                  severity: "high",
                  channel: "in_app",
                  title: "DN Trade інтеграція не працює",
                  body: `Стан "${h.status}" уже ${streak} хв. Причини: ${h.blockers.join("; ") || "невідомо"}.`,
                  link: "/brand",
                  metadata: {
                    streak_minutes: streak,
                    blockers: h.blockers,
                    warnings: h.warnings,
                  } as never,
                });
                alerted = true;
              }
            }
          }

          // 3b. Повторювані partial-синки.
          if (!alerted) {
            const { data: partialRows } = await supabaseAdmin.rpc(
              "dntrade_partial_count_recent",
              { _tenant_id: integ.tenant_id, _hours: ALERT_PARTIAL_WINDOW_HOURS },
            );
            const partialCount =
              typeof partialRows === "number"
                ? partialRows
                : Number(partialRows ?? 0);
            if (partialCount >= ALERT_PARTIAL_THRESHOLD) {
              const recent = await hasRecentAlert(
                integ.tenant_id,
                "dntrade_partial_repeat",
              );
              if (!recent) {
                await supabaseAdmin.from("owner_notifications").insert({
                  tenant_id: integ.tenant_id,
                  kind: "dntrade_partial_repeat",
                  severity: "high",
                  channel: "in_app",
                  title: "DN Trade: повторювані помилки синхронізації",
                  body: `${partialCount} часткових синків за останні ${ALERT_PARTIAL_WINDOW_HOURS} год. Перевірте мапінг товарів/клієнтів.`,
                  link: "/brand",
                  metadata: {
                    partial_count: partialCount,
                    window_hours: ALERT_PARTIAL_WINDOW_HOURS,
                  } as never,
                });
                alerted = true;
              }
            }
          }

          results.push({
            tenant_id: integ.tenant_id,
            status: h.status,
            alerted,
          });
        }

        return jsonOk({ processed: results.length, results });
      },
    },
  },
});
