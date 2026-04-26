/**
 * POST /api/telegram/user/sign-in  body: { tenant_id, code, password? }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authBearer, canManageTenant, jsonResponse, TENANT_RE } from "@/lib/telegram/auth";
import { isBridgeConfigured, signIn } from "@/lib/telegram/mtprotoBridge";

export const Route = createFileRoute("/api/telegram/user/sign-in")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authBearer(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const body = (await request.json().catch(() => ({}))) as {
          tenant_id?: string;
          code?: string;
          password?: string;
        };
        const tenantId = body.tenant_id ?? "";
        const code = (body.code ?? "").trim();
        const password = body.password ? String(body.password) : undefined;
        if (!TENANT_RE.test(tenantId)) return jsonResponse({ error: "invalid_tenant" }, 400);
        if (!/^\d{4,7}$/.test(code)) return jsonResponse({ error: "invalid_code" }, 400);
        if (!(await canManageTenant(auth.userId, tenantId)))
          return jsonResponse({ error: "forbidden" }, 403);
        if (!isBridgeConfigured()) return jsonResponse({ error: "bridge_not_configured" }, 503);

        const { data: existing } = await supabaseAdmin
          .from("tg_user_sessions")
          .select("phone,login_state,status")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        const phone = (existing as { phone?: string } | null)?.phone ?? "";
        const loginState = ((existing as { login_state?: Record<string, unknown> } | null)
          ?.login_state ?? {}) as {
          phone_code_hash?: string;
        };
        const hash = loginState.phone_code_hash ?? "";
        if (!phone || !hash) return jsonResponse({ error: "no_pending_code" }, 400);

        const r = await signIn({
          tenant_id: tenantId,
          phone,
          phone_code_hash: hash,
          code,
          password,
        });
        if (!r.ok) {
          if (r.code === "password_required") {
            await supabaseAdmin
              .from("tg_user_sessions")
              .update({ status: "password_required" } as never)
              .eq("tenant_id", tenantId);
            return jsonResponse({ error: "password_required" }, 200);
          }
          return jsonResponse(
            { error: r.code, message: r.message },
            r.code === "flood_wait" ? 429 : 400,
          );
        }

        await supabaseAdmin
          .from("tg_user_sessions")
          .update({
            status: "active",
            encrypted_session: r.session_enc,
            user_id_tg: r.user_id,
            username: r.username,
            first_name: r.first_name,
            dc_id: r.dc_id,
            login_state: {} as never,
            last_used_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq("tenant_id", tenantId);

        return jsonResponse({
          ok: true,
          user_id: r.user_id,
          username: r.username,
          first_name: r.first_name,
        });
      },
    },
  },
});
