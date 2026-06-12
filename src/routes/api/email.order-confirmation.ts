/**
 * POST /api/email/order-confirmation
 *
 * Викликається з checkout одразу після `place_storefront_order`.
 * Без авторизації — публічна дія (покупець анонімний), але:
 *   - перевіряє що замовлення існує
 *   - має idempotency: повторні виклики не дублюють листи (status=sent у email_sends)
 *   - логує всі спроби в email_sends
 *
 * Body: { orderId: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";
import { renderOrderConfirmation } from "@/lib/email/templates";
import { loadOrderEmailContext, alreadySent, logEmailSend } from "@/lib/email/orderContext";
import { clientIp, createIpRateLimiter } from "@/lib/http/rateLimit";

const TEMPLATE = "order_confirmation";
const limiter = createIpRateLimiter({ limit: 20 });

export const Route = createFileRoute("/api/email/order-confirmation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        let body: { orderId?: unknown };
        try {
          body = (await request.json()) as { orderId?: unknown };
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          return Response.json({ error: "invalid_order_id" }, { status: 400 });
        }

        const ctx = await loadOrderEmailContext(orderId);
        if (!ctx.ok) {
          return Response.json({ error: ctx.error }, { status: ctx.status });
        }

        if (await alreadySent(orderId, TEMPLATE)) {
          return Response.json({ ok: true, skipped: "already_sent" }, { status: 200 });
        }

        const { subject, html, text } = renderOrderConfirmation(ctx.ctx);
        const result = await sendEmailViaGateway({
          to: ctx.ctx.customerEmail,
          subject,
          html,
          text,
          fromName: ctx.ctx.brandName,
          tags: [
            { name: "template", value: TEMPLATE },
            { name: "tenant", value: ctx.tenantId.slice(0, 16) },
          ],
        });

        if (result.ok) {
          await logEmailSend({
            tenantId: ctx.tenantId,
            orderId: ctx.orderId,
            toEmail: ctx.ctx.customerEmail,
            template: TEMPLATE,
            subject,
            status: "sent",
            resendMessageId: result.id,
          });
          return Response.json({ ok: true, id: result.id }, { status: 200 });
        }

        await logEmailSend({
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          toEmail: ctx.ctx.customerEmail,
          template: TEMPLATE,
          subject,
          status: "failed",
          error: result.error,
        });
        return Response.json({ ok: false, error: result.error }, { status: 502 });
      },
    },
  },
});
