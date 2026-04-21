/**
 * Email Abandoned Cart Agent (Sprint 6).
 *
 * Знаходить існуючі cart_recovery_attempts (створені агентом cart-recovery)
 * для яких:
 *  - канал = "email"
 *  - не відправлено листа за останні 7 днів (email_sends.template = 'abandoned_cart')
 *  - є валідний email клієнта
 *  - клієнт має consent_marketing = true (маркетингова згода)
 *
 * Надсилає шаблон abandoned-cart і логує в email_sends.
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
import { renderAbandonedCart } from "@/lib/email/marketingTemplates";

const AGENT_ID = "email_abandoned_cart";
const TEMPLATE = "abandoned_cart";
const DEDUP_DAYS = 7;

function appBase(): string {
  return (process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "https://e-marq.lovable.app").replace(/\/+$/, "");
}

export const Route = createFileRoute("/hooks/agents/email-abandoned-cart")({
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
          const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

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
          const cartUrl = `${storeUrl}/checkout`;

          // Знаходимо abandoned attempts з мапінгом до customer
          const { data: attempts } = await supabaseAdmin
            .from("cart_recovery_attempts")
            .select("id, customer_id, cart_value_cents, cart_items, abandoned_at")
            .eq("tenant_id", tenantId)
            .eq("recovered", false)
            .gte("created_at", since)
            .not("customer_id", "is", null)
            .limit(200);

          if (!attempts?.length) {
            await finishAgentRun(handle, 0, { reason: "no_attempts" });
            return jsonOk({ insights_created: 0, sent: 0 });
          }

          const customerIds = attempts.map((a) => a.customer_id).filter((c): c is string => !!c);
          const { data: customers } = await supabaseAdmin
            .from("customers")
            .select("id, email, name, consent_marketing, unsubscribe_token")
            .eq("tenant_id", tenantId)
            .in("id", customerIds);
          const cMap = new Map((customers ?? []).map((c) => [c.id, c]));

          // Dedup: чи відправляли цьому email лист `abandoned_cart` за DEDUP_DAYS
          const dedupSince = new Date(Date.now() - DEDUP_DAYS * 24 * 3600 * 1000).toISOString();
          const emails = (customers ?? []).map((c) => c.email).filter((e): e is string => !!e);
          const sentSet = new Set<string>();
          if (emails.length) {
            const { data: prevSends } = await supabaseAdmin
              .from("email_sends")
              .select("to_email")
              .eq("tenant_id", tenantId)
              .eq("template", TEMPLATE)
              .eq("status", "sent")
              .gte("created_at", dedupSince)
              .in("to_email", emails);
            for (const s of prevSends ?? []) sentSet.add(s.to_email.toLowerCase());
          }

          // Збираємо назви продуктів одним запитом
          const allProductIds = new Set<string>();
          for (const a of attempts) {
            const items = (a.cart_items as Array<{ product_id?: string }> | null) ?? [];
            for (const it of items) if (it.product_id) allProductIds.add(it.product_id);
          }
          const { data: products } = allProductIds.size
            ? await supabaseAdmin
                .from("products")
                .select("id, name")
                .eq("tenant_id", tenantId)
                .in("id", Array.from(allProductIds))
            : { data: [] };
          const pMap = new Map((products ?? []).map((p) => [p.id, p.name]));

          let sent = 0;
          let skipped = 0;
          for (const a of attempts) {
            const customer = a.customer_id ? cMap.get(a.customer_id) : null;
            if (!customer || !customer.email) { skipped++; continue; }
            if (!customer.consent_marketing) { skipped++; continue; }
            if (sentSet.has(customer.email.toLowerCase())) { skipped++; continue; }

            const items = (a.cart_items as Array<{ product_id?: string }> | null) ?? [];
            const productNames = items
              .map((it) => (it.product_id ? pMap.get(it.product_id) : null))
              .filter((n): n is string => !!n);
            if (!productNames.length) { skipped++; continue; }

            const unsubUrl = `${appBase()}/api/public/email/unsubscribe?t=${encodeURIComponent(customer.unsubscribe_token)}`;
            const { subject, html, text } = renderAbandonedCart({
              brandName,
              storeUrl,
              customerName: customer.name,
              cartUrl,
              productNames,
              cartValueCents: a.cart_value_cents,
              currency: "UAH",
              unsubscribeUrl: unsubUrl,
            });

            const result = await sendEmailViaGateway({
              to: customer.email,
              subject,
              html,
              text,
              fromName: brandName,
              tenantId,
              category: "marketing",
              unsubscribeToken: customer.unsubscribe_token,
              tags: [
                { name: "template", value: TEMPLATE },
                { name: "tenant", value: tenantId.slice(0, 16) },
              ],
            });

            await supabaseAdmin.from("email_sends").insert({
              tenant_id: tenantId,
              to_email: customer.email,
              template: TEMPLATE,
              subject,
              status: result.ok ? "sent" : "failed",
              resend_message_id: result.ok ? result.id : null,
              error: result.ok ? null : result.error,
              metadata: { attempt_id: a.id, cart_value_cents: a.cart_value_cents },
            });

            // Локально зафіксувати щоб не дублювати в межах одного прогону
            sentSet.add(customer.email.toLowerCase());
            if (result.ok) sent++;
          }

          await finishAgentRun(handle, 0, { sent, skipped, considered: attempts.length });
          return jsonOk({ insights_created: 0, sent, skipped, considered: attempts.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Email abandoned cart failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
