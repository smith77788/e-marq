/**
 * POST /api/marq-keys
 *
 * Authenticated tenant member endpoint — mints a new API key for the
 * tenant, used by brand storefronts to call the public MARQ API.
 *
 * Body: { tenant_id, name, tier?, scopes? }
 * Response: { id, name, plaintext, prefix, tier, scopes, created_at }
 *
 * The plaintext key is returned ONLY ONCE in this response. We persist
 * only the SHA-256 hash + 8-char prefix.
 *
 * GET /api/marq-keys?tenant_id=...
 *   Returns existing key metadata (no plaintext, no hash).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, createIpRateLimiter } from "@/lib/http/rateLimit";

const limiter = createIpRateLimiter({ limit: 10 });
import { mintApiKey } from "@/lib/marq-public-api/auth";

const PostBody = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  tier: z.enum(["public_readonly", "public_write", "server_full"]).default("public_write"),
  scopes: z.array(z.string().min(1).max(64)).max(20).optional(),
});

const GetQuery = z.object({ tenant_id: z.string().uuid() });

function jerr(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function authedClient(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { error: jerr(401, "Missing bearer") };
  const token = auth.slice(7).trim();
  const url = process.env.SUPABASE_URL;
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !pub) return { error: jerr(500, "Server not configured") };
  const client = createClient<Database>(url, pub, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const claims = await client.auth.getClaims(token);
  const userId = claims.data?.claims?.sub;
  if (claims.error || !userId) return { error: jerr(401, "Invalid token") };
  return { client, userId };
}

export const Route = createFileRoute("/api/marq-keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const a = await authedClient(request);
        if ("error" in a) return a.error;

        const url = new URL(request.url);
        let q: z.infer<typeof GetQuery>;
        try {
          q = GetQuery.parse(Object.fromEntries(url.searchParams));
        } catch (e) {
          return jerr(400, e instanceof Error ? e.message : "Invalid query");
        }

        const { data: isMember } = await a.client.rpc("is_tenant_member", {
          _tenant_id: q.tenant_id,
        });
        if (!isMember) return jerr(403, "Not a member");

        const { data, error } = await supabaseAdmin
          .from("tenant_api_keys")
          .select(
            "id, name, key_prefix, tier, scopes, is_active, created_at, last_used_at, revoked_at",
          )
          .eq("tenant_id", q.tenant_id)
          .order("created_at", { ascending: false });
        if (error) return jerr(500, error.message);
        return Response.json({ keys: data ?? [] });
      },
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }
        const a = await authedClient(request);
        if ("error" in a) return a.error;

        let body: z.infer<typeof PostBody>;
        try {
          body = PostBody.parse(await request.json());
        } catch (e) {
          return jerr(400, e instanceof Error ? e.message : "Invalid body");
        }

        const { data: isMember } = await a.client.rpc("is_tenant_member", {
          _tenant_id: body.tenant_id,
        });
        if (!isMember) return jerr(403, "Not a member");

        const minted = await mintApiKey("pk");
        const scopes = body.scopes ?? ["events:write", "insights:read", "recommendations:read"];

        const { data, error } = await supabaseAdmin
          .from("tenant_api_keys")
          .insert({
            tenant_id: body.tenant_id,
            name: body.name,
            key_prefix: minted.prefix,
            key_hash: minted.hash,
            tier: body.tier,
            scopes,
            created_by: a.userId,
          })
          .select("id, name, tier, scopes, created_at")
          .single();
        if (error || !data) return jerr(500, error?.message ?? "Failed to mint key");

        return Response.json({
          ...data,
          key_prefix: minted.prefix,
          plaintext: minted.plaintext,
          warning: "Save this key now — it cannot be retrieved later.",
        });
      },
    },
  },
});
