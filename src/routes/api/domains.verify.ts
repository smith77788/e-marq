/**
 * POST /api/domains/verify
 * Body: { domainId: string }
 *
 * Виконує справжню перевірку TXT-запису через DNS-over-HTTPS (Cloudflare 1.1.1.1).
 * Шукає в TXT-записах піддомену `_marq-verify.<domain>` точне співпадіння
 * з verification_token. Якщо знайшли — статус active + verified_at.
 * Інакше — failed з коротким описом проблеми.
 *
 * Worker-сумісно: тільки fetch(). Жодних Node.js dns/dgram модулів.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

type DohAnswer = { name: string; type: number; TTL: number; data: string };
type DohResponse = { Status: number; Answer?: DohAnswer[] };

/** Resolve TXT records for a hostname using Cloudflare DoH (Worker-friendly). */
async function lookupTxt(hostname: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=TXT`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  const r = await fetch(url, { headers: { Accept: "application/dns-json" }, signal: ctrl.signal }).finally(() => clearTimeout(t));
  if (!r.ok) throw new Error(`DoH ${r.status}`);
  const j = (await r.json()) as DohResponse;
  if (!j.Answer) return [];
  return j.Answer.filter((a) => a.type === 16).map((a) =>
    // DoH returns TXT data wrapped in quotes, e.g. "\"value\"". Strip them.
    a.data
      .split(/"\s+"/)
      .map((s) => s.replace(/^"|"$/g, ""))
      .join(""),
  );
}

/** Resolve CNAME records to confirm storefront target points to MARQ. */
async function lookupCname(hostname: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=CNAME`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  const r = await fetch(url, { headers: { Accept: "application/dns-json" }, signal: ctrl.signal }).finally(() => clearTimeout(t));
  if (!r.ok) return [];
  const j = (await r.json()) as DohResponse;
  if (!j.Answer) return [];
  return j.Answer.filter((a) => a.type === 5).map((a) => a.data.replace(/\.$/, "").toLowerCase());
}

const EXPECTED_CNAME_SUFFIXES = ["lovable.app", "e-marq.lovable.app"];

export const Route = createFileRoute("/api/domains/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authUser(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        let body: { domainId?: string };
        try {
          body = (await request.json()) as { domainId?: string };
        } catch {
          return jsonResponse({ error: "invalid_json" }, 400);
        }
        const domainId = body.domainId?.trim();
        if (!domainId) return jsonResponse({ error: "domainId_required" }, 400);

        const { data: row, error: rowErr } = await supabaseAdmin
          .from("tenant_domains")
          .select("id, tenant_id, domain, verification_token, status")
          .eq("id", domainId)
          .maybeSingle();
        if (rowErr || !row) return jsonResponse({ error: "domain_not_found" }, 404);

        const allowed = await userCanManageTenant(auth.userId, row.tenant_id);
        if (!allowed) return jsonResponse({ error: "forbidden" }, 403);

        // Перевіряємо TXT _marq-verify.<domain> + опційно CNAME
        const verifyHost = `_marq-verify.${row.domain}`;
        const expected = row.verification_token;

        const issues: string[] = [];
        let verified = false;
        let cnameOk = false;

        try {
          const txt = await lookupTxt(verifyHost);
          verified = txt.some((v) => v.trim() === expected);
          if (!verified) {
            issues.push(
              txt.length === 0
                ? `Не знайдено TXT-запис ${verifyHost}`
                : `TXT існує, але токен не збігається`,
            );
          }
        } catch (e) {
          issues.push(`DNS lookup failed: ${e instanceof Error ? e.message : "?"}`);
        }

        try {
          const cnames = await lookupCname(row.domain);
          cnameOk = cnames.some((c) =>
            EXPECTED_CNAME_SUFFIXES.some((s) => c === s || c.endsWith(`.${s}`)),
          );
          if (!cnameOk) {
            issues.push(
              cnames.length === 0
                ? `Немає CNAME для ${row.domain}`
                : `CNAME вказує на ${cnames[0]} (очікуємо *.lovable.app)`,
            );
          }
        } catch {
          // CNAME помилку трактуємо як необов'язкову — TXT головне
        }

        const newStatus: "active" | "failed" | "pending" = verified
          ? "active"
          : issues.length > 0
            ? "failed"
            : "pending";
        const update: Database["public"]["Tables"]["tenant_domains"]["Update"] = {
          status: newStatus,
          last_checked_at: new Date().toISOString(),
          notes: issues.length ? issues.join(" | ") : null,
        };
        if (verified) update.verified_at = new Date().toISOString();

        const { error: upErr } = await supabaseAdmin
          .from("tenant_domains")
          .update(update)
          .eq("id", domainId);
        if (upErr) return jsonResponse({ error: upErr.message }, 500);

        return jsonResponse({
          ok: true,
          verified,
          cnameOk,
          status: newStatus,
          issues,
        });
      },
    },
  },
});
