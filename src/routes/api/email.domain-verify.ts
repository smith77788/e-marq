/**
 * POST /api/email/domain-verify
 * Body: { tenantId }
 *
 * Викликає Resend POST /domains/{id}/verify, оновлює resend_status
 * в tenant_configs.features.email_settings.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";

async function authUser(req: Request): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/email/domain-verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authUser(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        let body: { tenantId?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonResponse({ error: "invalid_json" }, 400);
        }
        const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return jsonResponse({ error: "invalid_tenant" }, 400);
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
        const domainId = typeof email.resend_domain_id === "string" ? email.resend_domain_id : "";
        if (!domainId) return jsonResponse({ error: "domain_not_setup" }, 400);

        const lovableKey = process.env.LOVABLE_API_KEY;
        const resendKey = process.env.RESEND_API_KEY;
        if (!lovableKey || !resendKey) return jsonResponse({ error: "Resend connector not linked" }, 500);

        try {
          // Trigger verification
          await fetch(`${RESEND_GATEWAY}/domains/${domainId}/verify`, {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": resendKey },
          });
          // Re-read status
          const r = await fetch(`${RESEND_GATEWAY}/domains/${domainId}`, {
            headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": resendKey },
          });
          const j = (await r.json().catch(() => ({}))) as { status?: string; records?: unknown };
          email.resend_status = j.status ?? null;
          email.records = j.records ?? email.records ?? null;
          email.updated_at = new Date().toISOString();
          features.email_settings = email;
          await supabaseAdmin
            .from("tenant_configs")
            .upsert({ tenant_id: tenantId, features }, { onConflict: "tenant_id" });

          return jsonResponse({ ok: true, status: j.status ?? null, records: j.records ?? null });
        } catch (e) {
          return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 502);
        }
      },
    },
  },
});
