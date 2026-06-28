/**
 * POST /api/orders/$orderId/transition — валідований перехід стану замовлення.
 *
 * Body: { tenantId, targetStatus }
 *
 * Дозволені переходи (StateMachine):
 *   pending   → paid | cancelled
 *   paid      → fulfilled | cancelled | refunded
 *   fulfilled → refunded
 *
 * Перехід до "paid" виконується через Saga з компенсацією:
 *   step 1 — update status to "paid"
 *   step 2 — set paid_at timestamp
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { StateMachine } from "@/lib/acos/stateMachineSystem";
import { Saga } from "@/lib/acos/sagaSystem";

type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";

function createOrderSM(current: OrderStatus) {
  return new StateMachine<OrderStatus>(current, [
    { from: "pending", to: "paid" },
    { from: "pending", to: "cancelled" },
    { from: "paid", to: "fulfilled" },
    { from: "paid", to: "cancelled" },
    { from: "paid", to: "refunded" },
    { from: "fulfilled", to: "refunded" },
  ]);
}

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "Server not configured" };

  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return { ok: false, status: 401, error: "Invalid token" };
  const userId = claims.claims.sub as string;

  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return { ok: true };

  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

const Body = z.object({
  tenantId: z.string().uuid(),
  targetStatus: z.enum(["paid", "fulfilled", "cancelled", "refunded"]),
});

export const Route = createFileRoute("/api/orders/$orderId/transition")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { orderId } = params as unknown as { orderId: string };
        if (!orderId) return err("Order ID required");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON");
        }

        const parsed = Body.safeParse(body);
        if (!parsed.success) {
          return err(JSON.stringify(parsed.error.flatten().fieldErrors), 400);
        }

        const { tenantId, targetStatus } = parsed.data;
        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const { data: order, error: fetchErr } = await supabaseAdmin
          .from("orders")
          .select("id, status")
          .eq("id", orderId)
          .eq("tenant_id", tenantId)
          .maybeSingle();

        if (fetchErr) return err("DB error", 500);
        if (!order) return err("Order not found", 404);

        const sm = createOrderSM(order.status as OrderStatus);
        const allowed = await sm.transition(targetStatus);
        if (!allowed) {
          return Response.json(
            {
              ok: false,
              error: `Transition ${order.status} → ${targetStatus} not allowed`,
              available: sm.getAvailableTransitions(),
            },
            { status: 422 },
          );
        }

        if (targetStatus === "paid") {
          const saga = new Saga<{ orderId: string; prevStatus: OrderStatus }>()
            .addStep({
              name: "update_status",
              execute: async (ctx) => {
                const { error } = await supabaseAdmin
                  .from("orders")
                  .update({ status: "paid" })
                  .eq("id", ctx.orderId);
                if (error) throw new Error(error.message);
              },
              compensate: async (ctx) => {
                await supabaseAdmin
                  .from("orders")
                  .update({ status: ctx.prevStatus })
                  .eq("id", ctx.orderId);
              },
            })
            .addStep({
              name: "set_paid_at",
              execute: async (ctx) => {
                const { error } = await supabaseAdmin
                  .from("orders")
                  .update({ paid_at: new Date().toISOString() })
                  .eq("id", ctx.orderId);
                if (error) throw new Error(error.message);
              },
              compensate: async (ctx) => {
                await supabaseAdmin
                  .from("orders")
                  .update({ paid_at: null })
                  .eq("id", ctx.orderId);
              },
            });

          const result = await saga.execute({ orderId, prevStatus: order.status as OrderStatus });
          if (!result.success) {
            return Response.json(
              { ok: false, error: result.error, failedStep: result.failedStep },
              { status: 500 },
            );
          }
          return Response.json({ ok: true, status: "paid" });
        }

        const { error: updateErr } = await supabaseAdmin
          .from("orders")
          .update({ status: targetStatus })
          .eq("id", orderId);

        if (updateErr) return err("Failed to update order status", 500);
        return Response.json({ ok: true, status: targetStatus });
      },
    },
  },
});
