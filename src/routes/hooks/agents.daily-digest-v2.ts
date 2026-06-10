/**
 * Daily Digest v2 — тижневий rollup поверх daily_digests.
 * Запускається в понеділок (або примусово через POST):
 *  - агрегує метрики 7 minulых днів
 *  - порівнює з попереднім тижнем
 *  - формує weekly_summary і пушить як owner_notification (severity = info | warning)
 *
 * Збереження: ще один запис у daily_digests з digest_date = початок_тижня
 * та ключем `weekly` у metrics для UI-розрізнення.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  jsonError,
  jsonOk,
  startAgentRun,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "daily-digest-v2";

export const Route = createFileRoute("/hooks/agents/daily-digest-v2")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json()) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          const weekStart = new Date(today.getTime() - 7 * 86_400_000);
          const prevWeekStart = new Date(today.getTime() - 14 * 86_400_000);
          const digestDate = weekStart.toISOString().slice(0, 10);

          // Skip if already exists
          const { data: existing, error: existErr } = await supabaseAdmin
            .from("daily_digests")
            .select("id, metrics")
            .eq("tenant_id", tenantId)
            .eq("digest_date", digestDate);
          if (existErr) throw existErr;
          const alreadyWeekly = (existing ?? []).some(
            (d) => (d.metrics as Record<string, unknown>)?.weekly === true,
          );
          if (alreadyWeekly) {
            await finishAgentRun(handle, 0, {
              reason: "already_generated",
              digest_date: digestDate,
            });
            return jsonOk({ insights_created: 0, reason: "already_generated" });
          }

          const [thisWeek, prevWeek, openInsights] = await Promise.all([
            supabaseAdmin
              .from("orders")
              .select("total_cents, status")
              .eq("tenant_id", tenantId)
              .gte("created_at", weekStart.toISOString())
              .lt("created_at", today.toISOString())
              .in("status", ["paid", "fulfilled"])
              .limit(5000),
            supabaseAdmin
              .from("orders")
              .select("total_cents, status")
              .eq("tenant_id", tenantId)
              .gte("created_at", prevWeekStart.toISOString())
              .lt("created_at", weekStart.toISOString())
              .in("status", ["paid", "fulfilled"])
              .limit(5000),
            supabaseAdmin
              .from("ai_insights")
              .select("id, title, risk_level, status, expected_impact")
              .eq("tenant_id", tenantId)
              .in("status", ["new", "in_review"])
              .order("created_at", { ascending: false })
              .limit(100),
          ]);

          const tw = (thisWeek.data ?? []).filter((o) => ["paid", "fulfilled"].includes(o.status));
          const pw = (prevWeek.data ?? []).filter((o) => ["paid", "fulfilled"].includes(o.status));
          const twRev = tw.reduce((s, o) => s + o.total_cents, 0);
          const pwRev = pw.reduce((s, o) => s + o.total_cents, 0);
          const delta = pwRev > 0 ? (twRev - pwRev) / pwRev : 0;

          const insightsByRisk = {
            high: 0,
            medium: 0,
            low: 0,
          };
          for (const i of openInsights.data ?? []) {
            const k = (i.risk_level as keyof typeof insightsByRisk) ?? "low";
            if (k in insightsByRisk) insightsByRisk[k]++;
          }

          const highlights: Array<{ kind: string; text: string }> = [
            {
              kind: "weekly_revenue",
              text: `Тиждень закрито на ${formatCents(twRev)} (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}% vs попередній)`,
            },
            {
              kind: "orders",
              text: `${tw.length} оплачених замовлень за 7 днів`,
            },
            {
              kind: "open_insights",
              text: `${(openInsights.data ?? []).length} відкритих інсайтів (${insightsByRisk.high} high, ${insightsByRisk.medium} medium)`,
            },
          ];

          const recommended = (openInsights.data ?? [])
            .filter((i) => i.risk_level === "high")
            .slice(0, 5)
            .map((i) => ({
              insight_id: i.id,
              title: i.title,
              expected_impact: i.expected_impact,
              risk_level: i.risk_level,
            }));

          // Структурований тижневий звіт
          const trendEmoji = delta > 0.1 ? "🚀" : delta > 0 ? "📈" : delta > -0.1 ? "➡️" : "📉";
          const deltaTxt = `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`;
          const totalOpen = (openInsights.data ?? []).length;

          const lines: string[] = [];
          lines.push(`📅 <b>Тижневий звіт</b> — ${digestDate}`);
          lines.push("");
          lines.push("💰 <b>Виторг тижня</b>");
          lines.push(`• Цей тиждень: <b>${formatCents(twRev)}</b> ${trendEmoji} ${deltaTxt}`);
          lines.push(`• Минулий: ${formatCents(pwRev)}`);
          lines.push(`• Замовлень: <b>${tw.length}</b> (було ${pw.length})`);
          lines.push("");
          lines.push("🎯 <b>Інсайти відкрито</b>");
          lines.push(
            `🔴 ${insightsByRisk.high} високих · 🟡 ${insightsByRisk.medium} середніх · 🟢 ${insightsByRisk.low} низьких`,
          );

          if (recommended.length) {
            lines.push("");
            lines.push(`⚡️ <b>Що робити цього тижня</b>`);
            for (const r of recommended.slice(0, 3)) {
              lines.push(`• ${r.title}`);
            }
          }

          lines.push("");
          if (delta < -0.2) {
            lines.push("⚠️ <i>Виторг просів — варто переглянути топ-інсайти</i>");
          } else if (delta > 0.2) {
            lines.push("🎉 <i>Сильний тиждень — продовжуємо</i>");
          } else {
            lines.push(`<i>${totalOpen} відкритих інсайтів усього</i>`);
          }

          const summary = lines.join("\n");

          const { error: digestErr } = await supabaseAdmin.from("daily_digests").insert({
            tenant_id: tenantId,
            digest_date: digestDate,
            summary,
            highlights,
            metrics: {
              weekly: true,
              this_week_revenue_cents: twRev,
              prev_week_revenue_cents: pwRev,
              delta_pct: delta,
              this_week_orders: tw.length,
              prev_week_orders: pw.length,
              open_insights_total: (openInsights.data ?? []).length,
              open_insights_by_risk: insightsByRisk,
            },
            recommended_actions: recommended,
          });
          if (digestErr) throw digestErr;

          const { error: notifErr } = await supabaseAdmin.from("owner_notifications").insert({
            tenant_id: tenantId,
            kind: "weekly_digest",
            severity: delta < -0.2 ? "warning" : "info",
            title: `Тижневий звіт — ${digestDate}`,
            body: summary,
            link: "/brand",
            metadata: { digest_date: digestDate, weekly: true },
          });
          if (notifErr) throw notifErr;

          await finishAgentRun(handle, 1, {
            digest_date: digestDate,
            weekly_revenue_cents: twRev,
          });
          return jsonOk({ insights_created: 1, digest_date: digestDate });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Daily digest v2 failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});

function formatCents(c: number): string {
  return `${(c / 100).toFixed(c >= 1000 ? 0 : 2)} ₴`;
}
