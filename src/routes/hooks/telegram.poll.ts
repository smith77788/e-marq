/**
 * Telegram long-polling endpoint (SHARED bot for all tenants).
 *
 * Triggered every minute by pg_cron. Helpers live in
 * `@/lib/telegram/pollHelpers` so this route file stays minimal — the
 * TanStack code-splitter parses route files strictly and breaks if too much
 * helper logic lives alongside the `Route` export.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  MAX_RUNTIME_MS,
  MIN_REMAINING_MS,
  TG_GATEWAY,
  processCallback,
  processMessage,
  type TgUpdate,
} from "@/lib/telegram/pollHelpers";

export const Route = createFileRoute("/hooks/telegram/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lovableKey = process.env.LOVABLE_API_KEY;
        const tgKey = process.env.TELEGRAM_API_KEY;
        if (!lovableKey || !tgKey) {
          return new Response(
            JSON.stringify({ ok: false, error: "Telegram connector not configured" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const appOrigin = new URL(request.url).origin;
        const start = Date.now();
        let processed = 0;

        const { data: state } = await supabaseAdmin
          .from("telegram_bot_state")
          .select("update_offset")
          .eq("id", 1)
          .maybeSingle();
        let offset = state?.update_offset ?? 0;

        // Ensure no webhook is set — otherwise getUpdates will always return 409
        // ("Conflict: terminated by other getUpdates request"). This is a safe
        // no-op if the bot has no webhook configured.
        try {
          await fetch(`${TG_GATEWAY}/deleteWebhook`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": tgKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ drop_pending_updates: false }),
          });
        } catch (err) {
          console.warn("[telegram.poll] deleteWebhook failed (non-fatal)", err);
        }

        while (true) {
          const remaining = MAX_RUNTIME_MS - (Date.now() - start);
          if (remaining < MIN_REMAINING_MS) break;
          const timeout = Math.min(50, Math.max(1, Math.floor(remaining / 1000) - 5));

          const res = await fetch(`${TG_GATEWAY}/getUpdates`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": tgKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              offset,
              timeout,
              allowed_updates: ["message", "callback_query"],
            }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return new Response(
              JSON.stringify({
                ok: false,
                error: `getUpdates ${res.status}: ${errText.slice(0, 300)}`,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          const json = (await res.json()) as { ok: boolean; result: TgUpdate[] };
          const updates = json.result ?? [];
          if (updates.length === 0) continue;

          for (const u of updates) {
            try {
              if (u.callback_query) {
                await processCallback(u.callback_query, appOrigin);
              } else if (u.message) {
                await processMessage(u, appOrigin);
              }
            } catch (err) {
              console.error("[telegram.poll] update error", err);
            }
            processed++;
          }

          offset = Math.max(...updates.map((u) => u.update_id)) + 1;
          await supabaseAdmin
            .from("telegram_bot_state")
            .update({ update_offset: offset, updated_at: new Date().toISOString() })
            .eq("id", 1);
        }

        return new Response(JSON.stringify({ ok: true, processed, offset }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () =>
        new Response(JSON.stringify({ ok: true, hint: "POST to trigger long-poll" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
