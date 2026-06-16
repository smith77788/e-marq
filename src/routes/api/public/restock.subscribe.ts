/**
 * POST /api/public/restock/subscribe
 *
 * Server-side proxy for the `subscribe_restock_notification` Supabase RPC.
 * Wraps the call with per-IP rate limiting so anonymous callers cannot spam
 * the notification list.
 *
 * Rate limit: 5 subscriptions per IP per 10 minutes.
 *
 * Body: JSON { tenant_id, product_id, variant_id, email }
 * Response: JSON { ok: true } | { ok: false, error: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createIpRateLimiter, clientIp } from "@/lib/http/rateLimit";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  email: z.string().trim().email().max(255),
});

/** 5 subscription attempts per IP per 10 minutes. */
const restockLimiter = createIpRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

export const Route = createFileRoute("/api/public/restock/subscribe")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        const ip = clientIp(request);

        if (!restockLimiter.check(ip)) {
          return new Response(
            JSON.stringify({ ok: false, error: "rate_limit_exceeded" }),
            { status: 429, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid_input" }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }

        const { data, error } = await supabaseAdmin.rpc("subscribe_restock_notification", {
          _tenant_id: body.tenant_id,
          _product_id: body.product_id,
          _variant_id: (body.variant_id ?? null) as unknown as string,
          _email: body.email,
        });

        if (error) {
          const code = error.message?.trim();
          return new Response(
            JSON.stringify({ ok: false, error: code }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }

        const result = data as { already_subscribed?: boolean } | null;
        return new Response(
          JSON.stringify({ ok: true, already_subscribed: result?.already_subscribed ?? false }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
        );
      },
    },
  },
});
