/**
 * POST /api/email/domain-setup
 * Body: { tenantId, domain, from_email, from_name?, reply_to? }
 *
 * Створює запис домену в Resend (POST /domains), зберігає resend_domain_id +
 * SPF/DKIM-записи в tenant_configs.features.email_settings.
 *
 * Auth: Bearer JWT, ролі owner/admin/super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";

async function authUser(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing_bearer" };
  const token = auth.slice(7).trim();
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

const DOMAIN_RX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/email/domain-setup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authUser(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        let body: {
          tenantId?: unknown;
          domain?: unknown;
          from_email?: unknown;
          from_name?: unknown;
          reply_to?: unknown;
          region?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonResponse({ error: "invalid_json" }, 400);
        }

        const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(tenantId))
          return jsonResponse({ error: "invalid_tenant" }, 400);

        const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
        if (!DOMAIN_RX.test(domain)) return jsonResponse({ error: "invalid_domain" }, 400);

        const fromEmail = typeof body.from_email === "string" ? body.from_email.trim() : "";
        if (!EMAIL_RX.test(fromEmail)) return jsonResponse({ error: "invalid_from_email" }, 400);
        if (!fromEmail.toLowerCase().endsWith(`@${domain}`)) {
          return jsonResponse({ error: "from_email_domain_mismatch" }, 400);
        }

        const fromName =
          typeof body.from_name === "string" ? body.from_name.trim().slice(0, 80) : "";
        const replyTo = typeof body.reply_to === "string" ? body.reply_to.trim() : "";
        if (replyTo && !EMAIL_RX.test(replyTo))
          return jsonResponse({ error: "invalid_reply_to" }, 400);
        const region = typeof body.region === "string" ? body.region : "eu-west-1";

        if (!(await userCanManageTenant(auth.userId, tenantId))) {
          return jsonResponse({ error: "forbidden" }, 403);
        }

        const lovableKey = process.env.LOVABLE_API_KEY;
        const resendKey = process.env.RESEND_API_KEY;
        if (!lovableKey || !resendKey) {
          return jsonResponse({ error: "Resend connector not linked" }, 500);
        }

        // Create or fetch domain in Resend
        let resendDomainId: string | null = null;
        let resendStatus: string | null = null;
        let records: unknown = null;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15_000);
          const r = await fetch(`${RESEND_GATEWAY}/domains`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": resendKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: domain, region }),
            signal: ctrl.signal,
          }).finally(() => clearTimeout(t));
          const j = (await r.json().catch(() => ({}))) as {
            id?: string;
            status?: string;
            records?: unknown;
            message?: string;
            name?: string;
          };
          if (!r.ok) {
            // If domain already exists in Resend, look it up.
            if (r.status === 422 || (j.message ?? "").toLowerCase().includes("already")) {
              const listCtrl = new AbortController();
              const lt = setTimeout(() => listCtrl.abort(), 15_000);
              const list = await fetch(`${RESEND_GATEWAY}/domains`, {
                headers: {
                  Authorization: `Bearer ${lovableKey}`,
                  "X-Connection-Api-Key": resendKey,
                },
                signal: listCtrl.signal,
              }).finally(() => clearTimeout(lt));
              const lj = (await list.json().catch(() => ({}))) as {
                data?: Array<{ id: string; name: string; status: string }>;
              };
              const existing = (lj.data ?? []).find((d) => d.name?.toLowerCase() === domain);
              if (existing) {
                resendDomainId = existing.id;
                resendStatus = existing.status;
              } else {
                return jsonResponse({ error: j.message ?? `Resend HTTP ${r.status}` }, 502);
              }
            } else {
              return jsonResponse({ error: j.message ?? `Resend HTTP ${r.status}` }, 502);
            }
          } else {
            resendDomainId = j.id ?? null;
            resendStatus = j.status ?? null;
            records = j.records ?? null;
          }
        } catch (e) {
          return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 502);
        }

        // Persist into tenant_configs.features.email_settings
        const { data: cfg } = await supabaseAdmin
          .from("tenant_configs")
          .select("features")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        const features = (cfg?.features as Record<string, unknown> | null) ?? {};
        features.email_settings = {
          domain,
          from_email: fromEmail,
          from_name: fromName || null,
          reply_to: replyTo || null,
          resend_domain_id: resendDomainId,
          resend_status: resendStatus,
          records,
          updated_at: new Date().toISOString(),
        };

        // Update existing or insert new tenant_configs row
        const { data: existing } = await supabaseAdmin
          .from("tenant_configs")
          .select("tenant_id")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        const upErr = existing
          ? (
              await supabaseAdmin
                .from("tenant_configs")
                .update({ features: features as never })
                .eq("tenant_id", tenantId)
            ).error
          : (
              await supabaseAdmin.from("tenant_configs").insert({
                tenant_id: tenantId,
                brand_name: domain,
                features: features as never,
              })
            ).error;
        if (upErr) return jsonResponse({ error: upErr.message }, 500);

        return jsonResponse({
          ok: true,
          resend_domain_id: resendDomainId,
          resend_status: resendStatus,
          records,
        });
      },
    },
  },
});
