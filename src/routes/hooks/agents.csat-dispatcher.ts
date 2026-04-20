/**
 * CSAT Dispatcher — для кожного paid order 3-7 днів тому, по якому ще
 * не було outbound message типу 'csat_request', створює insight з
 * драфтом запиту фідбеку (1-5 stars). Відсіює клієнтів без consent.
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

const AGENT_ID = "csat-dispatcher";

type OrderRow = {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
  total_cents: number;
  paid_at: string | null;
};

export const Route = createFileRoute("/hooks/agents/csat-dispatcher")({
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
          const now = Date.now();
          const min = new Date(now - 7 * 86_400_000).toISOString();
          const max = new Date(now - 3 * 86_400_000).toISOString();

          const { data: orders, error } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, customer_name, total_cents, paid_at")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("paid_at", min)
            .lte("paid_at", max)
            .limit(500);
          if (error) throw error;
          const candidates = (orders ?? []) as OrderRow[];
          if (candidates.length === 0) {
            await finishAgentRun(handle, 0, { candidates: 0 });
            return jsonOk({ run_id: handle.runId, candidates: 0, insights_created: 0 });
          }

          // Skip those that already got a csat_request
          const ids = candidates.map((c) => c.id);
          const { data: existing } = await supabaseAdmin
            .from("outbound_messages")
            .select("metadata")
            .eq("tenant_id", tenantId)
            .eq("template_key", "csat_request")
            .in("metadata->>order_id", ids);
          const sentFor = new Set<string>();
          for (const e of existing ?? []) {
            const m = e.metadata as Record<string, unknown> | null;
            const oid = m?.order_id;
            if (typeof oid === "string") sentFor.add(oid);
          }

          const todo = candidates.filter((o) => !sentFor.has(o.id) && o.customer_email);

          const insights: AgentInsightInput[] = [];
          for (const o of todo.slice(0, 100)) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "csat_request",
              affected_layer: "crm",
              title: `Запит фідбеку: ${o.customer_name || o.customer_email}`,
              description: `Замовлення доставлено ~5 днів тому. Час просити оцінку — це повертає, дає UGC і вловлює проблеми до того як вони стануть refund.`,
              expected_impact: `Фідбек у "теплий момент" дає 30-40% response rate vs <10% пізніше.`,
              confidence: 0.8,
              risk_level: "low",
              metrics: {
                order_id: o.id,
                customer_email: o.customer_email,
                customer_name: o.customer_name,
                order_total_cents: o.total_cents,
                draft_ua: `Привіт ${o.customer_name?.split(" ")[0] || ""}! Як тобі замовлення? Постав 1-5 ⭐ — нам критично важлива твоя думка.`,
                draft_en: `Hey ${o.customer_name?.split(" ")[0] || ""}! How was your order? Rate it 1-5 ⭐ — your feedback matters a lot.`,
                suggested_action: "send_csat_request",
                template_key: "csat_request",
              },
              dedup_key: `csat::${o.id}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            candidates: candidates.length,
            already_sent: sentFor.size,
            queued: insights.length,
          });
          return jsonOk({
            run_id: handle.runId,
            candidates: candidates.length,
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
