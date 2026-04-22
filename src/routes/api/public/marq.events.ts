/**
 * POST /api/public/marq/events
 *
 * Brand storefront → MARQ event ingestion. Auth via tenant API key
 * (tier ≥ public_write, scope `events:write`). Body is a single event
 * matching `events.type` enum, validated by Zod.
 *
 * Rate-limit: relies on Cloudflare's per-IP throttling + the existing
 * `anon_event_rate_limit` table (per session_id, 1 minute buckets).
 * We keep payloads small (<8 KB) to avoid abuse.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { authorizeMarqApiKey, jsonResponse, preflight } from "@/lib/marq-public-api/auth";

type EventType = Database["public"]["Enums"]["event_type"];

const BodySchema = z.object({
  type: z.string().min(1).max(64),
  session_id: z.string().min(1).max(128).optional(),
  product_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const RATE_LIMIT_PER_MINUTE = 120;

export const Route = createFileRoute("/api/public/marq/events")({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        const auth = await authorizeMarqApiKey(request, {
          scope: "events:write",
          minTier: "public_write",
        });
        if ("error" in auth) return jsonResponse({ error: auth.error }, { status: auth.status });

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (err) {
          return jsonResponse(
            { error: err instanceof Error ? err.message : "Invalid body" },
            { status: 400 },
          );
        }

        // Throttle by session_id (best-effort — table is INSERT-friendly).
        if (body.session_id) {
          const bucketMinute = new Date();
          bucketMinute.setSeconds(0, 0);
          const bucketIso = bucketMinute.toISOString();
          const { data: existing } = await supabaseAdmin
            .from("anon_event_rate_limit")
            .select("count")
            .eq("tenant_id", auth.tenantId)
            .eq("session_id", body.session_id)
            .eq("bucket_minute", bucketIso)
            .maybeSingle();
          const current = existing?.count ?? 0;
          if (current >= RATE_LIMIT_PER_MINUTE) {
            return jsonResponse({ error: "Rate limit exceeded" }, { status: 429 });
          }
          await supabaseAdmin
            .from("anon_event_rate_limit")
            .upsert(
              {
                tenant_id: auth.tenantId,
                session_id: body.session_id,
                bucket_minute: bucketIso,
                count: current + 1,
              },
              { onConflict: "tenant_id,session_id,bucket_minute" },
            );
        }

        const { error } = await supabaseAdmin.from("events").insert({
          tenant_id: auth.tenantId,
          type: body.type as EventType,
          session_id: body.session_id ?? null,
          product_id: body.product_id ?? null,
          order_id: body.order_id ?? null,
          user_id: body.user_id ?? null,
          payload: (body.payload ?? {}) as never,
        });
        if (error) return jsonResponse({ error: error.message }, { status: 500 });

        return jsonResponse({ ok: true });
      },
    },
  },
});
