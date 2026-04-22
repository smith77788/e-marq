/**
 * POST /api/email/order-status
 *
 * Викликається з brand-orders UI після зміни статусу замовлення.
 * Потребує авторизації (Bearer JWT власника); перевіряємо що користувач
 * має доступ до tenant'а замовлення через members.
 *
 * Body: { orderId: string, newStatus: "paid"|"fulfilled"|"cancelled"|"refunded" }
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";
import { renderOrderStatusUpdate } from "@/lib/email/templates";
import { loadOrderEmailContext, alreadySent, logEmailSend } from "@/lib/email/orderContext";

const ALLOWED_STATUSES = ["paid", "fulfilled", "cancelled", "refunded"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

async function authenticateUser(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "missing_bearer" };
  }
  const token = auth.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "empty_token" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "server_misconfigured" };

  const sb = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true, userId: String(data.claims.sub) };
}

async function userCanManageTenant(userId: string, tenantId: string): Promise<boolean> {
  // Платформа-адмін має доступ до всього.
  const { data: superRole } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (superRole) return true;

  // Інакше — член tenant'у з роллю owner/admin/member.
  const { data: membership } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  const role = membership?.role;
  return role === "owner" || role === "admin" || role === "member";
}

export const Route = createFileRoute("/api/email/order-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateUser(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }

        let body: { orderId?: unknown; newStatus?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
        const newStatus = typeof body.newStatus === "string" ? body.newStatus.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          return Response.json({ error: "invalid_order_id" }, { status: 400 });
        }
        if (!ALLOWED_STATUSES.includes(newStatus as AllowedStatus)) {
          return Response.json({ error: "invalid_status" }, { status: 400 });
        }

        const ctx = await loadOrderEmailContext(orderId);
        if (!ctx.ok) {
          return Response.json({ error: ctx.error }, { status: ctx.status });
        }

        const allowed = await userCanManageTenant(auth.userId, ctx.tenantId);
        if (!allowed) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        const template = `order_status_${newStatus}`;
        if (await alreadySent(orderId, template)) {
          return Response.json({ ok: true, skipped: "already_sent" }, { status: 200 });
        }

        const { subject, html, text } = renderOrderStatusUpdate({
          ...ctx.ctx,
          newStatus: newStatus as AllowedStatus,
        });
        const result = await sendEmailViaGateway({
          to: ctx.ctx.customerEmail,
          subject,
          html,
          text,
          fromName: ctx.ctx.brandName,
          tags: [
            { name: "template", value: template },
            { name: "tenant", value: ctx.tenantId.slice(0, 16) },
          ],
        });

        if (result.ok) {
          await logEmailSend({
            tenantId: ctx.tenantId,
            orderId: ctx.orderId,
            toEmail: ctx.ctx.customerEmail,
            template,
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
          template,
          subject,
          status: "failed",
          error: result.error,
        });
        return Response.json({ ok: false, error: result.error }, { status: 502 });
      },
    },
  },
});
