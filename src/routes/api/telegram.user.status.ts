/**
 * GET  /api/telegram/user/status?tenant=<id>
 *   Стан персонального TG-акаунту: чи увійшли, чи готовий бридж, ім'я/username.
 *
 * POST /api/telegram/user/status  body: { tenant_id, action: "logout" }
 *   Завершує сесію (бридж + локальний запис).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authBearer, canManageTenant, jsonResponse, TENANT_RE } from "@/lib/telegram/auth";
import { isBridgeConfigured, logOut, whoAmI } from "@/lib/telegram/mtprotoBridge";

type SessionRow = {
  id: string;
  status: string;
  phone: string | null;
  user_id: number | null;
  username: string | null;
  first_name: string | null;
  session_enc: string | null;
  dc_id: number | null;
  last_used_at: string | null;
};

async function readSession(tenantId: string): Promise<SessionRow | null> {
  const { data } = await supabaseAdmin
    .from("tg_user_sessions")
    .select(
      "id,status,phone,user_id,username,first_name,session_enc,dc_id,last_used_at",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as SessionRow | null) ?? null;
}

export const Route = createFileRoute("/api/telegram/user/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authBearer(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenant") ?? "";
        if (!TENANT_RE.test(tenantId)) return jsonResponse({ error: "invalid_tenant" }, 400);
        if (!(await canManageTenant(auth.userId, tenantId)))
          return jsonResponse({ error: "forbidden" }, 403);

        const bridge_ready = isBridgeConfigured();
        const session = await readSession(tenantId);
        const status = session?.status ?? "none";

        let alive: boolean | null = null;
        if (bridge_ready && status === "active" && session?.session_enc) {
          const r = await whoAmI({ tenant_id: tenantId, session_enc: session.session_enc });
          alive = r.ok;
          if (!r.ok && r.code === "session_expired") {
            await supabaseAdmin
              .from("tg_user_sessions")
              .update({ status: "expired" } as never)
              .eq("tenant_id", tenantId);
          }
        }

        return jsonResponse({
          bridge_ready,
          status,
          alive,
          phone: session?.phone ?? null,
          user_id: session?.user_id ?? null,
          username: session?.username ?? null,
          first_name: session?.first_name ?? null,
          dc_id: session?.dc_id ?? null,
          last_used_at: session?.last_used_at ?? null,
          hint: bridge_ready
            ? null
            : "MTProto-міст ще не підключено. Розгорніть Node-сервіс і додайте секрети TG_MTPROTO_BRIDGE_URL/SECRET та TG_SESSION_ENC_KEY.",
        });
      },

      POST: async ({ request }) => {
        const auth = await authBearer(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
        const body = (await request.json().catch(() => ({}))) as {
          tenant_id?: string;
          action?: "logout";
        };
        const tenantId = body.tenant_id ?? "";
        if (!TENANT_RE.test(tenantId)) return jsonResponse({ error: "invalid_tenant" }, 400);
        if (!(await canManageTenant(auth.userId, tenantId)))
          return jsonResponse({ error: "forbidden" }, 403);
        if (body.action !== "logout") return jsonResponse({ error: "invalid_action" }, 400);

        const session = await readSession(tenantId);
        if (session?.session_enc && isBridgeConfigured()) {
          await logOut({ tenant_id: tenantId, session_enc: session.session_enc });
        }
        await supabaseAdmin
          .from("tg_user_sessions")
          .update({
            status: "logged_out",
            session_enc: null,
            phone_code_hash: null,
          } as never)
          .eq("tenant_id", tenantId);
        return jsonResponse({ ok: true });
      },
    },
  },
});
