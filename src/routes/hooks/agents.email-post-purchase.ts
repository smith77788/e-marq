/**
 * Email Post-Purchase Agent (Sprint 6).
 *
 * Знаходить замовлення, які:
 *  - status = 'fulfilled',
 *  - fulfilled_at: між 6 і 8 днів тому,
 *  - не було надіслано шаблон 'post_purchase' раніше,
 *  - є email клієнта.
 *
 * Надсилає шаблон з проханням залишити відгук.
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
import { renderPostPurchase } from "@/lib/email/marketingTemplates";

const AGENT_ID = "email_post_purchase";
const TEMPLATE = "post_purchase";

function appBase(): string {
  return (process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "https://e-marq.lovable.app").replace(/\/+$/, "");
}

export const Route = createFileRoute("/hooks/agents/email-post-purchase")({
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
          const dayMs = 86_400_000;
          const minFulfilled = new Date(now - 8 * dayMs).toISOString();
          const maxFulfilled = new Date(now - 6 * dayMs).toISOString();

          const [{ data: tenant }, { data: cfg }] = await Promise.all([
            supabaseAdmin.from("tenants").select("slug, name").eq("id", tenantId).maybeSingle(),
            supabaseAdmin.from("tenant_configs").select("brand_name").eq("tenant_id", tenantId).maybeSingle(),
          ]);
          if (!tenant) {
            await finishAgentRun(handle, 0, { reason: "no_tenant" });
            return jsonOk({ insights_created: 0, sent: 0 });
          }
          const brandName = cfg?.brand_name ?? tenant.name ?? "Store";
          const storeUrl = `${appBase()}/s/${encodeURIComponent(tenant.slug)}`;

          const { data: orders } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, customer_name, fulfilled_at")
            .eq("tenant_id", tenantId)
            .eq("status", "fulfilled")
            .gte("fulfilled_at", minFulfilled)
            .lte("fulfilled_at", maxFulfilled)
            .not("customer_email", "is", null)
            .limit(100);

          if (!orders?.length) {
            await finishAgentRun(handle, 0, { reason: "no_orders" });
            return jsonOk({ insights_created: 0, sent: 0 });
          }

          const orderIds = orders.map((o) => o.id);
          const { data: prevSends } = await supabaseAdmin
            .from("email_sends")
            .select("order_id")
            .eq("tenant_id", tenantId)
            .eq("template", TEMPLATE)
            .eq("status", "sent")
            .in("order_id", orderIds);
          const sentOrderIds = new Set((prevSends ?? []).map((s) => s.order_id));

          // Збираємо назви товарів за всіма order_items одним запитом
          const { data: allItems } = await supabaseAdmin
            .from("order_items")
            .select("order_id, product_name")
            .in("order_id", orderIds);
          const itemsByOrder = new Map<string, string[]>();
          for (const it of allItems ?? []) {
            if (!it.order_id) continue;
            const arr = itemsByOrder.get(it.order_id) ?? [];
            arr.push(it.product_name);
            itemsByOrder.set(it.order_id, arr);
          }

          // Спробуємо знайти customers щоб дістати unsubscribe_token
          const emails = orders.map((o) => o.customer_email!).filter(Boolean);
          const { data: customers } = emails.length
            ? await supabaseAdmin
                .from("customers")
                .select("email, unsubscribe_token, consent_marketing")
                .eq("tenant_id", tenantId)
                .in("email", emails)
            : { data: [] };
          const cMap = new Map((customers ?? []).map((c) => [c.email?.toLowerCase() ?? "", c]));

          let sent = 0;
          let skipped = 0;
          for (const o of orders) {
            if (sentOrderIds.has(o.id)) { skipped++; continue; }
            const email = o.customer_email!;
            const customer = cMap.get(email.toLowerCase());
            // Якщо клієнт відписався від маркетингу — не надсилаємо
            if (customer && customer.consent_marketing === false) { skipped++; continue; }
            const productNames = itemsByOrder.get(o.id) ?? [];
            if (!productNames.length) { skipped++; continue; }

            const reviewUrl = `${storeUrl}/orders/${o.id}`;
            const unsubToken = customer?.unsubscribe_token ?? "";
            const unsubUrl = unsubToken
              ? `${appBase()}/api/public/email/unsubscribe?t=${encodeURIComponent(unsubToken)}`
              : `${appBase()}/api/public/email/unsubscribe?t=manual`;

            const { subject, html, text } = renderPostPurchase({
              brandName,
              storeUrl,
              customerName: o.customer_name,
              orderShortId: o.id.slice(0, 8),
              productNames,
              reviewUrl,
              unsubscribeUrl: unsubUrl,
            });

            const result = await sendEmailViaGateway({
              to: email,
              subject,
              html,
              text,
              fromName: brandName,
              tenantId,
              category: "marketing",
              unsubscribeToken: unsubToken || undefined,
              tags: [
                { name: "template", value: TEMPLATE },
                { name: "tenant", value: tenantId.slice(0, 16) },
              ],
            });

            await supabaseAdmin.from("email_sends").insert({
              tenant_id: tenantId,
              order_id: o.id,
              to_email: email,
              template: TEMPLATE,
              subject,
              status: result.ok ? "sent" : "failed",
              resend_message_id: result.ok ? result.id : null,
              error: result.ok ? null : result.error,
            });

            if (result.ok) sent++;
          }

          await finishAgentRun(handle, 0, { sent, skipped, considered: orders.length });
          return jsonOk({ insights_created: 0, sent, skipped, considered: orders.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Post-purchase email failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
