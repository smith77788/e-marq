/**
 * Telegram webhook endpoint (push mode, replaces long-polling).
 *
 * Telegram POSTs updates here in real time. Idempotency via
 * `telegram_processed_updates.update_id` UNIQUE — if the same update is
 * delivered twice (Telegram retries on 5xx), we no-op.
 *
 * Security: `X-Telegram-Bot-Api-Secret-Token` must equal
 * `sha256("telegram-webhook:" + TELEGRAM_API_KEY).base64url`.
 *
 * Always returns 200 quickly; processing errors are logged but not surfaced
 * to Telegram (otherwise it would retry forever).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CORS_HEADERS, withCors } from "@/lib/http/cors";
import { processCallback, processMessage, type TgUpdate } from "@/lib/telegram/pollHelpers";

function jsonResponse(body: unknown, status = 200) {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function deriveSecret(apiKey: string): string {
  return createHash("sha256").update(`telegram-webhook:${apiKey}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        const tgKey = process.env.TELEGRAM_API_KEY;
        if (!tgKey) {
          return jsonResponse({ ok: false, error: "not_configured" });
        }

        const expected = deriveSecret(tgKey);
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) {
          return withCors(new Response("Unauthorized", { status: 401 }));
        }

        let update: TgUpdate;
        try {
          update = (await request.json()) as TgUpdate;
        } catch {
          return jsonResponse({ ok: true, ignored: "bad_json" });
        }

        if (typeof update.update_id !== "number") {
          return jsonResponse({ ok: true, ignored: "no_update_id" });
        }

        // Idempotency: if insert fails on PK conflict → already processed.
        const { error: dupErr } = await supabaseAdmin
          .from("telegram_processed_updates")
          .insert({ update_id: update.update_id });
        if (dupErr) {
          // duplicate or other error — return 200 so Telegram stops retrying
          return jsonResponse({ ok: true, duplicate: true });
        }

        const appOrigin = new URL(request.url).origin;
        try {
          if (update.callback_query) {
            await processCallback(update.callback_query, appOrigin);
          } else if (update.message) {
            await processMessage(update, appOrigin);
          }
        } catch (err) {
          console.error("[telegram.webhook] processing error", err);
          // still return 200 so Telegram doesn't retry
        }

        return jsonResponse({ ok: true });
      },
      GET: async () =>
        jsonResponse({ ok: true, hint: "Telegram webhook endpoint" }),
    },
  },
});
