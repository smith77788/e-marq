/**
 * GET /api/templates  — список шаблонів
 * POST /api/templates — створення шаблону або рендер
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTemplates, createTemplate, renderTemplate } from "@/lib/acos/templateSystem";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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
  const { data: sa } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (sa) return { ok: true };
  const { data: m } = await supabaseAdmin.from("tenant_memberships").select("role").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export const Route = createFileRoute("/api/templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = (url.searchParams.get("tenantId") ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        try {
          const templates = await getTemplates(tenantId);
          return Response.json({ ok: true, data: templates });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },

      POST: async ({ request }) => {
        let body: {
          tenantId?: string;
          name?: string;
          type?: string;
          content?: string;
          variables?: string[];
          templateId?: string;
          template?: string;
          data?: Record<string, string>;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return err("Invalid JSON");
        }

        // Render template: { template, data }
        if (body.template !== undefined) {
          if (!body.data || typeof body.data !== "object") return err("data required for render");
          try {
            const rendered = renderTemplate(body.template, body.data);
            return Response.json({ ok: true, data: rendered });
          } catch (e) {
            return err(e instanceof Error ? e.message : "Internal error", 500);
          }
        }

        // Create template: { tenantId, name, type/content, variables }
        const tenantId = (body.tenantId ?? "").trim();
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const name = (body.name ?? "").trim();
        const type = (body.type ?? "email").trim();
        const content = (body.content ?? "").trim();
        if (!name) return err("name required");
        if (!content) return err("content required");

        try {
          const result = await createTemplate(tenantId, name, type, content, {
            variables: body.variables,
          });
          return Response.json({ ok: true, data: result });
        } catch (e) {
          return err(e instanceof Error ? e.message : "Internal error", 500);
        }
      },
    },
  },
});
