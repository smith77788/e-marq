/**
 * POST /api/telegram/user/send-code  body: { tenant_id, phone }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authBearer, canManageTenant, jsonResponse, TENANT_RE } from "@/lib/telegram/auth";
import { isBridgeConfigured, sendCode } from "@/lib/telegram/mtprotoBridge";

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

export const Route = createFileRoute("/api/telegram/user/send-code")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authBearer(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const body = (await request.json().catch(() => ({}))) as {
          tenant_id?: string;
          phone?: string;
        };
        const tenantId = body.tenant_id ?? "";
        const phone = (body.phone ?? "").trim();
        if (!TENANT_RE.test(tenantId)) return jsonResponse({ error: "invalid_tenant" }, 400);
        if (!PHONE_RE.test(phone)) return jsonResponse({ error: "invalid_phone" }, 400);
        if (!(await canManageTenant(auth.userId, tenantId)))
          return jsonResponse({ error: "forbidden" }, 403);
        if (!isBridgeConfigured())
          return jsonResponse(
            {
              error: "bridge_not_configured",
              hint: "MTProto bridge не налаштовано. Додайте секрети TG_MTPROTO_BRIDGE_URL/SECRET/TG_SESSION_ENC_KEY.",
            },
            503,
          );

        const r = await sendCode({ tenant_id: tenantId, phone });
        if (!r.ok) {
          return jsonResponse(
            {
              error: r.code,
              message: r.message,
              retry_after_seconds: r.retry_after_seconds ?? null,
            },
            r.code === "flood_wait" ? 429 : 502,
          );
        }

        await supabaseAdmin.from("tg_user_sessions").upsert(
          {
            tenant_id: tenantId,
            phone,
            status: "code_sent",
            login_state: {
              phone_code_hash: r.phone_code_hash,
              next_type: r.next_type ?? null,
              timeout_seconds: r.timeout_seconds ?? null,
              sent_at: new Date().toISOString(),
            } as never,
            created_by: auth.userId,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "tenant_id" },
        );

        return jsonResponse({
          ok: true,
          next_type: r.next_type ?? null,
          timeout_seconds: r.timeout_seconds ?? null,
        });
      },
    },
  },
});
