/**
 * Detector — orders stuck in `pending` for >48h need manual review.
 * Always PROPOSE (never auto-modifies orders).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DetectorFn } from "../types";

export const detectOrdersStuck: DetectorFn = async ({ tenantId }) => {
  if (!tenantId) return [];
  // Skip pilot tenants: synthetic orders constantly stay in `pending` and
  // would otherwise flood Decision Inbox with BLOCK rows every 5 min.
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("is_pilot")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenant?.is_pilot) return [];
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: orders, count } = await supabaseAdmin
    .from("orders")
    .select("id, created_at", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(50);
  const total = count ?? orders?.length ?? 0;
  if (!orders || total === 0) return [];

  return [
    {
      detector: "orders_stuck",
      tenant_id: tenantId,
      severity: total > 10 ? "p1" : "p2",
      title: `${total} orders stuck in pending >48h`,
      root_cause: "Orders not transitioning out of pending state — payment/processing issue likely",
      scope: { tenant_id: tenantId, count: total, sample_ids: orders.slice(0, 10).map((o) => o.id) },
      fingerprint: `orders_stuck:${tenantId}`,
      regression_risk: "high", // touching orders = high risk → always PROPOSE
      proposed_actions: [
        {
          kind: "flag_stuck_order",
          payload: { tenant_id: tenantId, order_ids: orders.map((o) => o.id) },
          reversible: true,
          revert_payload: { order_ids: orders.map((o) => o.id), restore_status: "pending" },
        },
      ],
    },
  ];
};
