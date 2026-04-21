/**
 * Order Status Notifier Agent (Sprint 6).
 *
 * Polling-агент (cron), який синхронізує транзакційні листи зі змінами статусу:
 *
 * Дивиться замовлення з останніх 7 днів і для кожного status ∈ {paid, fulfilled, cancelled, refunded}:
 *  - якщо ще НЕ було відправлено `order_status_<status>` (за email_sends.template) — надсилає.
 *
 * Цей агент — safety net: основний шлях — UI-кнопка в brand.orders, яка миттєво
 * викликає /api/email/order-status. Cron агент гарантує що навіть зміни через
 * адмін-панель / DB / тригери не лишаться без оповіщення.
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
import { sendEmailViaGateway } from "@/lib/email/resendGateway";
import { renderOrderStatusUpdate } from "@/lib/email/templates";
import { loadOrderEmailContext } from "@/lib/email/orderContext";

const AGENT_ID = "order_status_notifier";
const TRACKED = ["paid", "fulfilled", "cancelled", "refunded"] as const;
type Tracked = (typeof TRACKED)[number];

export const Route = createFileRoute("/hooks/agents/order-status-notifier")({
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

          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("id, status, customer_email, updated_at")
            .eq("tenant_id", tenantId)
            .in("status", [...TRACKED])
            .gte("updated_at", since)
            .not("customer_email", "is", null)
            .limit(200);

          if (!orders?.length) {
            await finishAgentRun(handle, 0, { reason: "no_orders" });
            return jsonOk({ insights_created: 0, sent: 0 });
          }

          // Заздалегідь дістаємо вже відправлені статус-листи
          const orderIds = orders.map((o) => o.id);
          const { data: prevSends } = await supabaseAdmin
            .from("email_sends")
            .select("order_id, template")
            .eq("tenant_id", tenantId)
            .in("order_id", orderIds)
            .eq("status", "sent");
          const sentSet = new Set((prevSends ?? []).map((s) => `${s.order_id}::${s.template}`));

          let sent = 0;
          let skipped = 0;
          for (const o of orders) {
            const status = o.status as Tracked;
            const template = `order_status_${status}`;
            if (sentSet.has(`${o.id}::${template}`)) { skipped++; continue; }

            const ctxRes = await loadOrderEmailContext(o.id);
            if (!ctxRes.ok) { skipped++; continue; }

            const { subject, html, text } = renderOrderStatusUpdate({
              ...ctxRes.ctx,
              newStatus: status,
            });

            const result = await sendEmailViaGateway({
              to: ctxRes.ctx.customerEmail,
              subject,
              html,
              text,
              fromName: ctxRes.ctx.brandName,
              tenantId,
              category: "transactional",
              tags: [
                { name: "template", value: template },
                { name: "tenant", value: tenantId.slice(0, 16) },
              ],
            });

            await supabaseAdmin.from("email_sends").insert({
              tenant_id: tenantId,
              order_id: o.id,
              to_email: ctxRes.ctx.customerEmail,
              template,
              subject,
              status: result.ok ? "sent" : "failed",
              resend_message_id: result.ok ? result.id : null,
              error: result.ok ? null : result.error,
            });

            if (result.ok) sent++;
            sentSet.add(`${o.id}::${template}`);
          }

          await finishAgentRun(handle, 0, { sent, skipped, considered: orders.length });
          return jsonOk({ insights_created: 0, sent, skipped, considered: orders.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Order status notifier failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
