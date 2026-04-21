/**
 * Restock Notifier Agent (Sprint 6).
 *
 * Знаходить продукти, у яких `was_out_of_stock = true` і поточний `stock > 0`
 * (DB тригер виставляє цей прапорець коли stock переходить з 0 → >0).
 *
 * Для кожного такого товару:
 *  - дістає всі pending підписки в `restock_notifications`,
 *  - надсилає email-шаблон `restock`,
 *  - помічає підписку як `notified` з `notified_at = now()`,
 *  - скидає `was_out_of_stock` назад у `false`.
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
import { renderRestock } from "@/lib/email/marketingTemplates";

const AGENT_ID = "restock_notifier";
const TEMPLATE = "restock";

function appBase(): string {
  return (process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "https://e-marq.lovable.app").replace(/\/+$/, "");
}

export const Route = createFileRoute("/hooks/agents/restock-notifier")({
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

          // Кандидати: продукти що "повернулися"
          const { data: products } = await supabaseAdmin
            .from("products")
            .select("id, name, url_handle")
            .eq("tenant_id", tenantId)
            .eq("was_out_of_stock", true)
            .gt("stock", 0)
            .eq("is_active", true)
            .limit(50);

          if (!products?.length) {
            await finishAgentRun(handle, 0, { reason: "no_restocked_products" });
            return jsonOk({ insights_created: 0, sent: 0, products_processed: 0 });
          }

          let totalSent = 0;
          let totalSkipped = 0;

          for (const p of products) {
            const productUrl = `${storeUrl}/products/${p.id}`;

            const { data: subs } = await supabaseAdmin
              .from("restock_notifications")
              .select("id, customer_email, customer_id")
              .eq("tenant_id", tenantId)
              .eq("product_id", p.id)
              .eq("status", "pending")
              .limit(500);

            if (!subs?.length) {
              // Все одно скидаємо прапорець, щоб не повторювати
              await supabaseAdmin
                .from("products")
                .update({ was_out_of_stock: false })
                .eq("id", p.id)
                .eq("tenant_id", tenantId);
              continue;
            }

            // Підвантажимо customer'и одним запитом для unsubscribe_token + ім'я
            const emails = subs.map((s) => s.customer_email);
            const { data: customers } = await supabaseAdmin
              .from("customers")
              .select("email, name, unsubscribe_token, consent_marketing")
              .eq("tenant_id", tenantId)
              .in("email", emails);
            const cMap = new Map((customers ?? []).map((c) => [c.email?.toLowerCase() ?? "", c]));

            const notifiedIds: string[] = [];
            for (const sub of subs) {
              const customer = cMap.get(sub.customer_email.toLowerCase());
              // Restock — "ти просив повідомити", тому це не маркетинг — це
              // явно запитана дія; але якщо клієнт відписався від маркетингу
              // повністю, поважаємо це.
              if (customer && customer.consent_marketing === false) { totalSkipped++; continue; }

              const unsubToken = customer?.unsubscribe_token ?? "";
              const unsubUrl = unsubToken
                ? `${appBase()}/api/public/email/unsubscribe?t=${encodeURIComponent(unsubToken)}`
                : `${appBase()}/api/public/email/unsubscribe?t=manual`;

              const { subject, html, text } = renderRestock({
                brandName,
                storeUrl,
                customerName: customer?.name ?? null,
                productName: p.name,
                productUrl,
                unsubscribeUrl: unsubUrl,
              });

              const result = await sendEmailViaGateway({
                to: sub.customer_email,
                subject,
                html,
                text,
                fromName: brandName,
                tenantId,
                category: "transactional", // це явно запитана дія
                unsubscribeToken: unsubToken || undefined,
                tags: [
                  { name: "template", value: TEMPLATE },
                  { name: "tenant", value: tenantId.slice(0, 16) },
                ],
              });

              await supabaseAdmin.from("email_sends").insert({
                tenant_id: tenantId,
                to_email: sub.customer_email,
                template: TEMPLATE,
                subject,
                status: result.ok ? "sent" : "failed",
                resend_message_id: result.ok ? result.id : null,
                error: result.ok ? null : result.error,
                metadata: { product_id: p.id, subscription_id: sub.id },
              });

              if (result.ok) {
                totalSent++;
                notifiedIds.push(sub.id);
              } else {
                totalSkipped++;
              }
            }

            // Помічаємо успішно повідомлених
            if (notifiedIds.length) {
              await supabaseAdmin
                .from("restock_notifications")
                .update({ status: "notified", notified_at: new Date().toISOString() })
                .in("id", notifiedIds);
            }

            // Скидаємо прапорець, щоб агент не дублював у наступний прогін
            await supabaseAdmin
              .from("products")
              .update({ was_out_of_stock: false })
              .eq("id", p.id)
              .eq("tenant_id", tenantId);
          }

          await finishAgentRun(handle, 0, {
            sent: totalSent,
            skipped: totalSkipped,
            products_processed: products.length,
          });
          return jsonOk({
            insights_created: 0,
            sent: totalSent,
            skipped: totalSkipped,
            products_processed: products.length,
          });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Restock notifier failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
