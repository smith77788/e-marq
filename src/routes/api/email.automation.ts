import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sendAutomatedEmail,
  triggerEmailSequence,
  CART_ABANDONMENT_SEQUENCE,
  WINBACK_SEQUENCE,
  POST_PURCHASE_SEQUENCE,
} from "@/lib/acos/emailAutomation";

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

const SEQUENCES: Record<string, typeof CART_ABANDONMENT_SEQUENCE> = {
  cart_abandonment: CART_ABANDONMENT_SEQUENCE,
  winback: WINBACK_SEQUENCE,
  post_purchase: POST_PURCHASE_SEQUENCE,
};

export const Route = createFileRoute("/api/email/automation")({
  // @ts-expect-error TanStack Router action type
  async action({ request }) {
    if (request.method !== "POST") return err("Method not allowed", 405);

    const body = (await request.json()) as Record<string, unknown>;
    const tenantId = (body.tenantId as string) ?? "";
    if (!tenantId) return err("Missing tenantId");

    const auth = await resolveAuth(request, tenantId);
    if (!auth.ok) return err(auth.error, auth.status);

    const action = (body.action as string) ?? "";

    if (action === "send") {
      const sequenceId = (body.sequenceId as string) ?? "";
      const stepIndex = typeof body.stepIndex === "number" ? body.stepIndex : 0;
      const ctx = (body.ctx as Parameters<typeof sendAutomatedEmail>[3]) ?? null;
      if (!sequenceId || !ctx) return err("Missing sequenceId or ctx");
      const sequence = SEQUENCES[sequenceId];
      if (!sequence) return err("Unknown sequenceId");
      const result = await sendAutomatedEmail(tenantId, sequence, stepIndex, ctx);
      if (!result.ok) return err(result.error ?? "Failed to send", 500);
      return Response.json({ ok: true });
    }

    if (action === "trigger") {
      const sequenceType = (body.sequenceType as string) ?? "";
      const ctx = (body.ctx as Parameters<typeof triggerEmailSequence>[2]) ?? null;
      if (!sequenceType || !ctx) return err("Missing sequenceType or ctx");
      const result = await triggerEmailSequence(tenantId, sequenceType, ctx);
      if (!result.ok) return err(result.error ?? "Failed to trigger", 500);
      return Response.json({ ok: true, scheduled: result.scheduled });
    }

    return err("Invalid action. Use 'send' or 'trigger'");
  },
});
