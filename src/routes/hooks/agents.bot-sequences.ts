/**
 * Bot Sequences — auto-detect customers stuck in mid-conversation with the bot
 * (3+ inbound msgs, 0 outbound replies in last 48h) and surface as insights so
 * sales-bot can resume. Also flags repeat-question patterns (intent appearing
 * 5+ times across customers) → suggest FAQ entry.
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

const AGENT_ID = "bot-sequences";

type ConvRow = {
  id: string;
  customer_id: string | null;
  direction: string;
  intent: string | null;
  created_at: string;
};

export const Route = createFileRoute("/hooks/agents/bot-sequences")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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
          const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("conversations")
            .select("id, customer_id, direction, intent, created_at")
            .eq("tenant_id", tenantId)
            .gte("created_at", since)
            .limit(20_000);
          if (error) throw error;
          const rows = (data ?? []) as ConvRow[];
          if (rows.length === 0) {
            await finishAgentRun(handle, 0, { rows: 0 });
            return jsonOk({ run_id: handle.runId, rows: 0, insights_created: 0 });
          }

          // Per-customer aggregate
          type Stat = { inbound: number; outbound: number; lastIn: number; lastOut: number; intents: Set<string> };
          const byCust = new Map<string, Stat>();
          const intentTally = new Map<string, Set<string>>();
          for (const r of rows) {
            if (!r.customer_id) continue;
            const s = byCust.get(r.customer_id) ?? {
              inbound: 0,
              outbound: 0,
              lastIn: 0,
              lastOut: 0,
              intents: new Set<string>(),
            };
            const t = new Date(r.created_at).getTime();
            if (r.direction === "inbound") {
              s.inbound++;
              if (t > s.lastIn) s.lastIn = t;
              if (r.intent) s.intents.add(r.intent);
            } else {
              s.outbound++;
              if (t > s.lastOut) s.lastOut = t;
            }
            byCust.set(r.customer_id, s);

            if (r.intent && r.direction === "inbound") {
              const set = intentTally.get(r.intent) ?? new Set<string>();
              set.add(r.customer_id);
              intentTally.set(r.intent, set);
            }
          }

          const stuck: Array<{ custId: string; inbound: number; intents: string[] }> = [];
          const cutoff = Date.now() - 48 * 3600 * 1000;
          for (const [custId, s] of byCust) {
            if (s.inbound >= 3 && s.lastIn < cutoff && s.lastIn > s.lastOut) {
              stuck.push({ custId, inbound: s.inbound, intents: Array.from(s.intents) });
            }
          }

          const custIds = stuck.map((s) => s.custId);
          const { data: customers } = custIds.length
            ? await supabaseAdmin
                .from("customers")
                .select("id, email, name")
                .in("id", custIds)
            : { data: [] };
          const custMap = new Map((customers ?? []).map((c) => [c.id, c]));

          const insights: AgentInsightInput[] = [];
          for (const s of stuck.slice(0, 50)) {
            const c = custMap.get(s.custId);
            if (!c) continue;
            insights.push({
              tenant_id: tenantId,
              insight_type: "bot_sequence_stuck",
              affected_layer: "crm",
              title: `${c.name || c.email}: ${s.inbound} повідомлень — без відповіді`,
              description: `Клієнт писав боту ${s.inbound} разів, остання відповідь >48год тому. Інтенти: ${s.intents.join(", ") || "невідомо"}. Втрачаємо живий лід.`,
              expected_impact: `Швидка відповідь на застряглу розмову конвертить ~25%.`,
              confidence: 0.75,
              risk_level: "medium",
              metrics: {
                customer_id: c.id,
                customer_email: c.email,
                customer_name: c.name,
                inbound_count: s.inbound,
                intents: s.intents,
                suggested_action: "resume_bot_sequence",
              },
              dedup_key: `bot_stuck::${c.id}`,
            });
          }

          // Recurring intents → FAQ candidate
          for (const [intent, custs] of intentTally) {
            if (custs.size < 5) continue;
            insights.push({
              tenant_id: tenantId,
              insight_type: "faq_candidate",
              affected_layer: "content",
              title: `Питання "${intent}" — ${custs.size} клієнтів за тиждень`,
              description: `Один і той самий інтент повторюється у ${custs.size} різних клієнтів. Готовий FAQ-блок або auto-reply закриє це назавжди.`,
              expected_impact: `Зменшить ручну роботу боту на ~${custs.size} запитів/тиждень.`,
              confidence: 0.7,
              risk_level: "low",
              metrics: {
                intent,
                customer_count: custs.size,
                suggested_action: "create_faq_entry",
              },
              dedup_key: `faq::${intent}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { stuck: stuck.length, intents: intentTally.size });
          return jsonOk({
            run_id: handle.runId,
            stuck: stuck.length,
            recurring_intents: intentTally.size,
            insights_created: created,
          });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Agent failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
