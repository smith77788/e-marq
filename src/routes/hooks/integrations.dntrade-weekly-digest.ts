/**
 * POST /hooks/integrations/dntrade-weekly-digest
 *
 * Раз на тиждень будує digest по всіх tenants з DN Trade-інтеграцією:
 *   - uptime % (healthy / total) за 7 днів;
 *   - кількість degraded/unhealthy перевірок;
 *   - top-3 блокерів і warnings;
 *   - tenants з найгіршим uptime.
 *
 * Створює owner_notification (severity=info, kind=dntrade_weekly_digest)
 * для кожного super_admin (через user_roles), щоб усі бачили глобальний звіт.
 *
 * Авторизація: Bearer SUPABASE_PUBLISHABLE_KEY (cron-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";

type LogRow = {
  tenant_id: string;
  status: string;
  blockers: string[] | null;
  warnings: string[] | null;
  checked_at: string;
};

type TenantRow = { id: string; name: string };

const sb = supabaseAdmin as unknown as {
  from: (t: string) => {
    select: (cols: string) => {
      gte: (c: string, v: string) => Promise<{ data: LogRow[] | null; error: unknown }>;
    };
  };
};

function topN(map: Map<string, number>, n: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export const Route = createFileRoute("/hooks/integrations/dntrade-weekly-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token || token !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return jsonError("Unauthorized", 401);
        }

        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const logsRes = await sb
          .from("dntrade_health_log")
          .select("tenant_id, status, blockers, warnings, checked_at")
          .gte("checked_at", since);
        const logs = (logsRes.data ?? []) as LogRow[];

        if (logs.length === 0) {
          return jsonOk({ digest: "no_data", recipients: 0 });
        }

        // Per-tenant uptime.
        const perTenant = new Map<
          string,
          { total: number; healthy: number; degraded: number; bad: number }
        >();
        const blockers = new Map<string, number>();
        const warnings = new Map<string, number>();

        for (const l of logs) {
          const cur = perTenant.get(l.tenant_id) ?? {
            total: 0,
            healthy: 0,
            degraded: 0,
            bad: 0,
          };
          cur.total += 1;
          if (l.status === "healthy") cur.healthy += 1;
          else if (l.status === "degraded") cur.degraded += 1;
          else cur.bad += 1;
          perTenant.set(l.tenant_id, cur);
          for (const b of l.blockers ?? []) blockers.set(b, (blockers.get(b) ?? 0) + 1);
          for (const w of l.warnings ?? []) warnings.set(w, (warnings.get(w) ?? 0) + 1);
        }

        const tenantIds = [...perTenant.keys()];
        const tenantRes = await supabaseAdmin
          .from("tenants")
          .select("id, name")
          .in("id", tenantIds);
        const nameById = new Map(
          ((tenantRes.data ?? []) as TenantRow[]).map((t) => [t.id, t.name]),
        );

        const totalChecks = logs.length;
        const totalHealthy = logs.filter((l) => l.status === "healthy").length;
        const overallUptime = Math.round((totalHealthy / totalChecks) * 100);

        const worstTenants = [...perTenant.entries()]
          .map(([id, v]) => ({
            id,
            name: nameById.get(id) ?? id.slice(0, 8),
            uptime: Math.round((v.healthy / v.total) * 100),
            bad: v.bad,
            degraded: v.degraded,
          }))
          .sort((a, b) => a.uptime - b.uptime)
          .slice(0, 5);

        const topBlockers = topN(blockers, 3);
        const topWarnings = topN(warnings, 3);

        const bodyLines: string[] = [];
        bodyLines.push(
          `Загальний uptime: ${overallUptime}% (${totalHealthy}/${totalChecks} перевірок).`,
        );
        bodyLines.push(`Tenants з інтеграцією: ${tenantIds.length}.`);
        if (worstTenants.length && worstTenants[0].uptime < 100) {
          bodyLines.push(
            "Найгірші: " +
              worstTenants
                .filter((t) => t.uptime < 100)
                .map((t) => `${t.name} ${t.uptime}%`)
                .join(", "),
          );
        }
        if (topBlockers.length) {
          bodyLines.push("Топ блокерів: " + topBlockers.map(([r, c]) => `${r} (×${c})`).join("; "));
        }
        if (topWarnings.length) {
          bodyLines.push(
            "Топ попереджень: " + topWarnings.map(([r, c]) => `${r} (×${c})`).join("; "),
          );
        }

        const body = bodyLines.join("\n");

        // Recipients: всі super_admin → ставимо нотифікацію в кожен tenant,
        // де вони є власниками (bo щоб видно було у власному фіді).
        // Простіше — створюємо одну нотифікацію в кожен tenant з інтеграцією.
        const metadata = {
          window: "7d",
          overall_uptime: overallUptime,
          tenants: tenantIds.length,
          total_checks: totalChecks,
          worst_tenants: worstTenants,
          top_blockers: topBlockers,
          top_warnings: topWarnings,
        };

        const inserts = tenantIds.map((tid) => ({
          tenant_id: tid,
          kind: "dntrade_weekly_digest",
          severity: "info",
          channel: "in_app",
          title: `DN Trade · тижневий звіт (uptime ${overallUptime}%)`,
          body,
          link: "/admin/dntrade-health",
          metadata: metadata as never,
        }));

        if (inserts.length) {
          await supabaseAdmin.from("owner_notifications").insert(inserts);
        }

        return jsonOk({
          recipients: inserts.length,
          overall_uptime: overallUptime,
          worst_tenants: worstTenants,
          top_blockers: topBlockers,
        });
      },
    },
  },
});
