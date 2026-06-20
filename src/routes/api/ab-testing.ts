/**
 * GET  /api/ab-testing?tenantId=xxx — get A/B test results for a specific test.
 * POST /api/ab-testing — create a test or track a conversion.
 *
 * Auth: Bearer JWT, roles owner / admin / super_admin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getAbTestResults,
  createAbTest,
  trackConversion,
} from "@/lib/acos/abTesting";

function err(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

async function resolveAuth(
  request: Request,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
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

  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return { ok: true };

  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!m) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export const Route = createFileRoute("/api/ab-testing")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        const testId = url.searchParams.get("testId") ?? "";
        if (!tenantId) return err("tenantId required");
        if (!testId) return err("testId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        const tests = await getAbTestResults(testId);
        return Response.json({ ok: true, tests });
      },

      POST: async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const tenantId = (body.tenantId as string) ?? "";
        if (!tenantId) return err("tenantId required");

        const auth = await resolveAuth(request, tenantId);
        if (!auth.ok) return err(auth.error, auth.status);

        // Track conversion: { tenantId, testId, userId, variant, orderCents }
        if (body.testId !== undefined) {
          const testId = body.testId as string;
          const userId = (body.userId as string) ?? "";
          const variant = (body.variant as "a" | "b") ?? "a";
          const orderCents = (body.orderCents as number) ?? 0;
          if (!testId) return err("testId required");
          await trackConversion(testId, variant, userId, orderCents);
          return Response.json({ ok: true });
        }

        // Create test: { tenantId, testKey, name, metric, variantA, variantB }
        const testKey = (body.testKey as string) ?? "";
        const name = (body.name as string) ?? "";
        const metric = (body.metric as string) ?? "conversion";
        const variantA = body.variantA as { id: string; name: string; config: Record<string, unknown> };
        const variantB = body.variantB as { id: string; name: string; config: Record<string, unknown> };
        if (!testKey || !name || !variantA || !variantB) {
          return err("testKey, name, variantA and variantB required");
        }

        const test = await createAbTest(tenantId, testKey, name, metric, variantA, variantB);
        return Response.json({ ok: true, test });
      },
    },
  },
});
