import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSecrets, storeSecret, deleteSecret, rotateSecret } from "@/lib/acos/secretManagementSystem";

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

export const Route = createFileRoute("/api/admin/secrets")({
  async loader({ request }) {
    const u = new URL(request.url);
    const tenantId = u.searchParams.get("tenantId") ?? "";
    if (!tenantId) return err("Missing tenantId");

    const auth = await resolveAuth(request, tenantId);
    if (!auth.ok) return err(auth.error, auth.status);

    const secrets = await getSecrets(tenantId);
    return Response.json({ ok: true, secrets });
  },

  async action({ request }) {
    const body = (await request.json()) as Record<string, unknown>;
    const tenantId = (body.tenantId as string) ?? "";
    if (!tenantId) return err("Missing tenantId");

    const auth = await resolveAuth(request, tenantId);
    if (!auth.ok) return err(auth.error, auth.status);

    if (request.method === "POST") {
      const key = (body.key as string) ?? "";
      if (!key) return err("Missing required field: key");

      const actionParam = (body.action as string) ?? "";

      if (actionParam === "rotate") {
        const newValue = (body.value as string) ?? "";
        if (!newValue) return err("Missing required field: value for rotation");
        // Look up secret id by name
        const secrets = await getSecrets(tenantId);
        const secret = secrets.find((s) => s.name === key);
        if (!secret) return err("Secret not found", 404);
        const result = await rotateSecret(secret.id, newValue);
        return Response.json({ ok: result.ok });
      }

      const value = (body.value as string) ?? "";
      if (!value) return err("Missing required field: value");
      const result = await storeSecret(tenantId, key, "api_key", value);
      if (!result.ok) return err("Failed to store secret", 500);
      return Response.json({ ok: true, id: result.id });
    }

    if (request.method === "DELETE") {
      const key = (body.key as string) ?? "";
      if (!key) return err("Missing required field: key");
      // Look up secret id by name
      const secrets = await getSecrets(tenantId);
      const secret = secrets.find((s) => s.name === key);
      if (!secret) return err("Secret not found", 404);
      const result = await deleteSecret(secret.id);
      return Response.json({ ok: result.ok });
    }

    return err("Method not allowed", 405);
  },
});
