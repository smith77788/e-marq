/**
 * GET  /api/telegram/status?tenant=<id>
 *  Повертає статус Telegram-бота для кабінету:
 *    - чи підключено connector (`TELEGRAM_API_KEY` + `LOVABLE_API_KEY`)
 *    - чи відповідає бот (getMe → username/first_name)
 *    - чи активовані канали `telegram` / `instagram` в outreach_settings
 *
 * POST /api/telegram/status (action: "enable_outreach" | "disable_outreach")
 *  Вмикає/вимикає telegram (та optionally instagram) у `active_channels`
 *  у таблиці `outreach_settings`. Доступно лише admin/owner/super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TG_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

type TelegramStatus = {
  connected: boolean;
  bot_username: string | null;
  bot_name: string | null;
  bot_id: number | null;
  outreach_telegram_enabled: boolean;
  outreach_instagram_enabled: boolean;
  error?: string;
  hint?: string;
};

async function authUser(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing_bearer" };
  const token = auth.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "empty_token" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "server_misconfigured" };

  const sb = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true, userId: data.user.id };
}

async function userCanManageTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return true;
  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return m?.role === "owner" || m?.role === "admin";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readActiveChannels(
  tenantId: string,
): Promise<{ telegram: boolean; instagram: boolean }> {
  const { data } = await supabaseAdmin
    .from("outreach_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "active_channels")
    .maybeSingle();
  const v = (data?.value as Record<string, boolean> | null) ?? null;
  return {
    telegram: v?.telegram === true,
    instagram: v?.instagram === true,
  };
}

async function readBot(): Promise<
  | { ok: true; id: number; name: string; username: string | null }
  | {
      ok: false;
      reason: "missing_lovable_key" | "missing_tg_key" | "request_failed";
      detail?: string;
    }
> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) return { ok: false, reason: "missing_lovable_key" };
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!tgKey) return { ok: false, reason: "missing_tg_key" };
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${TG_GATEWAY}/getMe`, {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timeout));
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { id?: number; first_name?: string; username?: string };
      description?: string;
    };
    if (!r.ok || !j.ok || !j.result?.id) {
      return { ok: false, reason: "request_failed", detail: j.description ?? `HTTP ${r.status}` };
    }
    return {
      ok: true,
      id: j.result.id,
      name: j.result.first_name ?? "Telegram bot",
      username: j.result.username ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      reason: "request_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export const Route = createFileRoute("/api/telegram/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authUser(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenant") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
          return jsonResponse({ error: "invalid_tenant" }, 400);
        }
        if (!(await userCanManageTenant(auth.userId, tenantId))) {
          return jsonResponse({ error: "forbidden" }, 403);
        }

        const channels = await readActiveChannels(tenantId);
        const bot = await readBot();

        const result: TelegramStatus = {
          connected: bot.ok,
          bot_username: bot.ok ? bot.username : null,
          bot_name: bot.ok ? bot.name : null,
          bot_id: bot.ok ? bot.id : null,
          outreach_telegram_enabled: channels.telegram,
          outreach_instagram_enabled: channels.instagram,
        };

        if (!bot.ok) {
          if (bot.reason === "missing_lovable_key" || bot.reason === "missing_tg_key") {
            result.error = "Telegram-конектор ще не підключено до проєкту.";
            result.hint =
              "У робочому просторі натисніть «Підключити Telegram» — ми безпечно збережемо токен бота через Lovable Cloud.";
          } else {
            result.error = bot.detail ?? "Бот не відповідає.";
            result.hint =
              "Перевірте, чи токен бота досі активний і чи бот не заблоковано в @BotFather.";
          }
        }
        return jsonResponse(result);
      },

      POST: async ({ request }) => {
        const auth = await authUser(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const body = (await request.json().catch(() => ({}))) as {
          tenant_id?: string;
          action?: "enable_outreach" | "disable_outreach";
          include_instagram?: boolean;
        };
        const tenantId = body.tenant_id ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
          return jsonResponse({ error: "invalid_tenant" }, 400);
        }
        if (!(await userCanManageTenant(auth.userId, tenantId))) {
          return jsonResponse({ error: "forbidden" }, 403);
        }
        if (body.action !== "enable_outreach" && body.action !== "disable_outreach") {
          return jsonResponse({ error: "invalid_action" }, 400);
        }

        const enable = body.action === "enable_outreach";
        const includeInstagram = body.include_instagram === true;

        // Read current channels (preserve existing)
        const { data: cur } = await supabaseAdmin
          .from("outreach_settings")
          .select("value")
          .eq("tenant_id", tenantId)
          .eq("key", "active_channels")
          .maybeSingle();
        const current = (cur?.value as Record<string, boolean> | null) ?? {
          reddit: true,
          google: false,
          blog: false,
          telegram: false,
          instagram: false,
        };

        const next: Record<string, boolean> = {
          ...current,
          telegram: enable,
        };
        if (includeInstagram) next.instagram = enable;

        const { error: upErr } = await supabaseAdmin.from("outreach_settings").upsert(
          {
            tenant_id: tenantId,
            key: "active_channels",
            value: next as never,
            updated_by: auth.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,key" },
        );
        if (upErr) return jsonResponse({ error: upErr.message }, 500);

        return jsonResponse({
          ok: true,
          outreach_telegram_enabled: next.telegram === true,
          outreach_instagram_enabled: next.instagram === true,
        });
      },
    },
  },
});
