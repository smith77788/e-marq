/**
 * Notification Router — чистить owner_notifications: дедуплікує
 * зайві (одна і та сама kind протягом 24 год → залишаємо найновіше),
 * автоматично mark-as-read low-severity старші за 7 днів,
 * і генерує insight, якщо за 24 год було >20 notifications одного типу
 * (значить агент-source шумить).
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  insertInsightsDedup,
  jsonError,
  jsonOk,
  startAgentRun,
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";

const AGENT_ID = "notification-router";

export const Route = createFileRoute("/hooks/agents/notification-router")({
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
          const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
          const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

          const { data, error } = await supabaseAdmin
            .from("owner_notifications")
            .select("id, kind, severity, is_read, created_at, title")
            .eq("tenant_id", tenantId)
            .gte("created_at", since7d)
            .order("created_at", { ascending: false })
            .limit(5000);
          if (error) throw error;
          const notifs = data ?? [];

          // 1. Auto-mark-read low/info older than 7 days
          const oldLowRead: string[] = [];
          const cutoff7d = Date.now() - 7 * 86_400_000;
          for (const n of notifs) {
            if (
              !n.is_read &&
              (n.severity === "info" || n.severity === "low") &&
              new Date(n.created_at).getTime() < cutoff7d
            ) {
              oldLowRead.push(n.id);
            }
          }

          // 2. Dedupe within 24h: keep newest per kind
          const seen = new Set<string>();
          const dupesToMarkRead: string[] = [];
          for (const n of notifs) {
            if (new Date(n.created_at).toISOString() < since24h) continue;
            if (n.is_read) continue;
            if (seen.has(n.kind)) {
              dupesToMarkRead.push(n.id);
            } else {
              seen.add(n.kind);
            }
          }

          const toMark = Array.from(new Set([...oldLowRead, ...dupesToMarkRead]));
          if (toMark.length > 0) {
            for (let i = 0; i < toMark.length; i += 200) {
              const chunk = toMark.slice(i, i + 200);
              const { error: upErr } = await supabaseAdmin
                .from("owner_notifications")
                .update({ is_read: true })
                .in("id", chunk);
              if (upErr) throw upErr;
            }
          }

          // 3. Detect noisy notification kinds (>20 in 24h)
          const counts = new Map<string, number>();
          for (const n of notifs) {
            if (new Date(n.created_at).toISOString() < since24h) continue;
            counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
          }
          const insights: AgentInsightInput[] = [];
          for (const [kind, c] of counts) {
            if (c > 20) {
              insights.push({
                tenant_id: tenantId,
                insight_type: "notification_noise_detected",
                affected_layer: "system",
                title: `Notification "${kind}" шумить (${c} штук за 24 год)`,
                description:
                  "Власник не розгрібає шум — або підвищ severity threshold, або згрупуй у дайджест.",
                expected_impact: "Знизити noise → fewer ignored notifications, owner trust ↑.",
                confidence: 0.85,
                risk_level: "medium",
                metrics: {
                  kind,
                  count_24h: c,
                  suggested_action: "raise_threshold_or_batch_into_digest",
                },
                dedup_key: `notif_noise::${kind}`,
              });
            }
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            scanned: notifs.length,
            marked_read: toMark.length,
            noisy_kinds: Object.fromEntries(counts),
          });
          return jsonOk({
            run_id: handle.runId,
            scanned: notifs.length,
            marked_read: toMark.length,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Notification router failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
