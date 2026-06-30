import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getEmailCampaigns,
  analyzeEmailPerformance,
  createEmailCampaign,
} from "@/lib/acos/emailSystem";

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

export const Route = createFileRoute("/api/email/campaigns")({
  // @ts-expect-error TanStack Router loader type
  async loader({ request }) {
    const u = new URL(request.url);
    const tenantId = u.searchParams.get("tenantId") ?? "";
    if (!tenantId) return err("Missing tenantId");

    const auth = await resolveAuth(request as Request, tenantId);
    if (!auth.ok) return err(auth.error, auth.status);

    if (u.searchParams.get("performance") === "true") {
      const performance = await analyzeEmailPerformance(tenantId);
      return Response.json({ ok: true, performance });
    }

    const campaigns = await getEmailCampaigns(tenantId);
    return Response.json({ ok: true, campaigns });
  },

  // @ts-expect-error TanStack Router action type
  async action({ request }) {
    if (request.method !== "POST") return err("Method not allowed", 405);

    const body = (await request.json()) as {
      tenantId?: string;
      name?: string;
      subject?: string;
      body?: string;
      segment?: string;
    };
    const tenantId = body.tenantId ?? "";
    if (!tenantId) return err("Missing tenantId");

    const auth = await resolveAuth(request as Request, tenantId);
    if (!auth.ok) return err(auth.error, auth.status);

    if (!body.name || !body.subject || !body.body) {
      return err("Missing required fields: name, subject, body");
    }

    const result = await createEmailCampaign(
      tenantId,
      body.name,
      body.subject,
      body.body,
      body.segment,
    );
    if (!result.ok) return err("Failed to create campaign", 500);
    return Response.json({ ok: true, id: result.id });
  },
});
