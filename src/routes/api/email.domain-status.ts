/**
 * GET /api/email/domain-status?tenant=<id>
 *
 * Повертає статус домену відправника в Resend (через connector gateway).
 *
 * Логіка:
 *  - tenant_configs.features.email_settings = { domain, from_email, from_name, reply_to, resend_domain_id }
 *  - якщо resend_domain_id є — викликаємо GET /domains/{id} в Resend gateway,
 *  - інакше — повертаємо not_configured.
 *
 * Authentication: Bearer JWT, ролі owner/admin/super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";

type DomainStatus = {
  configured: boolean;
  domain: string | null;
  from_email: string | null;
  from_name: string | null;
  reply_to: string | null;
  resend_domain_id: string | null;
  resend_status: string | null; // 'pending' | 'verified' | 'failed' | null
  records: Array<{
    record: string;
    name: string;
    type: string;
    value: string;
    ttl?: string;
    status?: string;
  }> | null;
  error?: string;
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
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true, userId: String(data.claims.sub) };
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

export const Route = createFileRoute("/api/email/domain-status")({
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

        const { data: cfg } = await supabaseAdmin
          .from("tenant_configs")
          .select("features")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        const features = (cfg?.features as Record<string, unknown> | null) ?? {};
        const email = (features.email_settings as Record<string, unknown> | undefined) ?? {};
        const result: DomainStatus = {
          configured: false,
          domain: typeof email.domain === "string" ? email.domain : null,
          from_email: typeof email.from_email === "string" ? email.from_email : null,
          from_name: typeof email.from_name === "string" ? email.from_name : null,
          reply_to: typeof email.reply_to === "string" ? email.reply_to : null,
          resend_domain_id:
            typeof email.resend_domain_id === "string" ? email.resend_domain_id : null,
          resend_status: null,
          records: null,
        };

        if (!result.resend_domain_id) {
          result.configured = !!result.domain;
          return jsonResponse(result);
        }

        // Fetch live status from Resend
        const lovableKey = process.env.LOVABLE_API_KEY;
        const resendKey = process.env.RESEND_API_KEY;
        if (!lovableKey || !resendKey) {
          result.error = "Resend connector not linked";
          return jsonResponse(result);
        }

        try {
          const r = await fetch(`${RESEND_GATEWAY}/domains/${result.resend_domain_id}`, {
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": resendKey,
            },
          });
          const j = (await r.json().catch(() => ({}))) as {
            status?: string;
            records?: DomainStatus["records"];
            name?: string;
            message?: string;
          };
          if (!r.ok) {
            result.error = j.message ?? `HTTP ${r.status}`;
            return jsonResponse(result);
          }
          result.configured = true;
          result.resend_status = j.status ?? null;
          result.records = j.records ?? null;
          if (j.name && !result.domain) result.domain = j.name;
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e);
        }

        return jsonResponse(result);
      },
    },
  },
});
