/**
 * Reorder engine — autonomous.
 *
 * Looks at customers whose predicted_next_order_at has passed and have not been
 * contacted in the past 14 days. Queues a Telegram reorder ping per customer
 * (only if telegram_chat_id is present) referencing their last bought product.
 *
 * Then dispatches the queued messages immediately.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  jsonError,
  jsonOk,
  startAgentRun,
  finishAgentRun,
  failAgentRun,
} from "@/lib/acos/agentRuntime";
import { dispatchTenantOutbound, pickChannelForCustomer } from "@/lib/acos/channels";
import { getCadenceMultiplier } from "@/lib/acos/policyTuning";

const AGENT_ID = "reorder_engine";

type CustomerRow = {
  id: string;
  email: string | null;
  name: string | null;
  telegram_chat_id: string | null;
  total_orders: number;
  avg_order_cents: number;
  predicted_next_order_at: string | null;
  last_contacted_at: string | null;
  last_order_at: string | null;
};

export const Route = createFileRoute("/hooks/engines/reorder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
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
          const cutoff = new Date().toISOString();
          // Self-tuning: cadence multiplier shifts the recency cooldown.
          const cadence = await getCadenceMultiplier(tenantId, "reorder");
          const cooldownDays = 14 * cadence;
          const recentlyContactedCutoff = new Date(Date.now() - cooldownDays * 24 * 3600 * 1000).toISOString();

          const { data: candidates, error } = await supabaseAdmin
            .from("customers")
            .select(
              "id, email, name, telegram_chat_id, total_orders, avg_order_cents, predicted_next_order_at, last_contacted_at, last_order_at",
            )
            .eq("tenant_id", tenantId)
            .gte("total_orders", 2)
            .eq("consent_marketing", true)
            .not("predicted_next_order_at", "is", null)
            .lte("predicted_next_order_at", cutoff)
            .or(`last_contacted_at.is.null,last_contacted_at.lt.${recentlyContactedCutoff}`)
            .limit(200);
          if (error) throw error;

          let queued = 0;
          for (const c of (candidates ?? []) as CustomerRow[]) {
            const channel = await pickChannelForCustomer(c.id);
            if (!channel) continue;

            // Find last bought product (best-effort)
            const { data: lastItems } = await supabaseAdmin
              .from("order_items")
              .select("product_name, product_id, orders!inner(customer_email, tenant_id, paid_at, status)")
              .eq("tenant_id", tenantId)
              .eq("orders.customer_email", c.email ?? "")
              .eq("orders.status", "paid")
              .order("created_at", { ascending: false })
              .limit(1);
            const productName = lastItems?.[0]?.product_name ?? "your favorite";
            const productId = lastItems?.[0]?.product_id ?? null;

            const firstName = (c.name ?? "").split(" ")[0] || "there";
            const body = `Hey ${firstName} 👋\n\nIt's about time to restock <b>${productName}</b>. Want me to set up your reorder?`;

            const { error: insErr } = await supabaseAdmin.from("outbound_messages").insert({
              tenant_id: tenantId,
              customer_id: c.id,
              channel,
              trigger_kind: "reorder",
              template_key: "reorder.v1",
              body,
              status: "pending",
              related_product_id: productId,
              expected_impact_cents: c.avg_order_cents || null,
              metadata: { predicted_next_order_at: c.predicted_next_order_at } as never,
            });
            if (!insErr) {
              queued++;
              // Mark customer as contacted (optimistic — flips again on send)
              await supabaseAdmin
                .from("customers")
                .update({ last_contacted_at: new Date().toISOString() })
                .eq("id", c.id);
              await supabaseAdmin.from("events").insert({
                tenant_id: tenantId,
                type: "reorder_triggered",
                payload: { customer_id: c.id, product_id: productId } as never,
              });
            }
          }

          // Now actually deliver
          const dispatchResult = await dispatchTenantOutbound(tenantId, 100);

          await finishAgentRun(handle, queued, {
            queued,
            dispatched_sent: dispatchResult.sent,
            dispatched_failed: dispatchResult.failed,
          });
          return jsonOk({
            queued,
            sent: dispatchResult.sent,
            failed: dispatchResult.failed,
            skipped: dispatchResult.skipped,
          });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Reorder engine failed", 500, { details: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  },
});
