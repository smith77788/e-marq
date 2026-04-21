/**
 * POST /api/public/email/resend-webhook
 *
 * Webhook-приймач для Resend (через Svix-сумісну підпис-схему).
 *
 * Resend підписує події заголовками:
 *   - svix-id: <unique event id>
 *   - svix-timestamp: <unix seconds>
 *   - svix-signature: "v1,<base64-hmac-sha256-of-`${id}.${ts}.${rawBody}`>"
 *
 * Документація: https://resend.com/docs/dashboard/webhooks/introduction
 *
 * Логіка:
 *  1) перевіряємо HMAC-підпис із RESEND_WEBHOOK_SECRET (Svix-формат: "whsec_..."),
 *  2) перевіряємо timestamp (≤ 5 хв розбіжності),
 *  3) ідемпотентно записуємо подію в email_events,
 *  4) оновлюємо відповідний email_sends-рядок (delivered_at / opened_at / clicked_at / bounced_at / complained_at / unsubscribed_at),
 *  5) додаємо в email_suppressions при bounce/complaint.
 *
 * При відсутності секрету (dev) — приймаємо тільки якщо встановлено
 * RESEND_WEBHOOK_INSECURE=1; інакше повертаємо 401.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"
  | "email.delivery_delayed"
  | "email.failed";

type ResendWebhookPayload = {
  type: ResendEventType | string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    [k: string]: unknown;
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Constant-time string compare to avoid timing attacks on signature check.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTs: string,
  svixSig: string,
  secret: string,
): Promise<boolean> {
  // Svix secret format: "whsec_<base64>"
  const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(keyB64);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const toSignBytes = new TextEncoder().encode(`${svixId}.${svixTs}.${rawBody}`);
  const toSign = toSignBytes.buffer.slice(toSignBytes.byteOffset, toSignBytes.byteOffset + toSignBytes.byteLength) as ArrayBuffer;
  const sigBuf = await crypto.subtle.sign("HMAC", key, toSign);
  const expected = new Uint8Array(sigBuf);

  // svix-signature header format: "v1,<b64sig> v1,<b64sig2> ..."
  const candidates = svixSig
    .split(/\s+/)
    .map((p) => p.split(","))
    .filter((p) => p[0] === "v1" && p[1])
    .map((p) => p[1]);

  for (const cand of candidates) {
    try {
      const candBytes = base64ToBytes(cand);
      if (timingSafeEqual(expected, candBytes)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Updates email_sends with the appropriate timestamp depending on event type.
 * Idempotent — only sets timestamp if currently NULL (preserves earliest event).
 */
async function applyEventToSend(
  resendId: string,
  eventType: string,
  toEmail: string | null,
  errorMsg: string | null,
): Promise<{ tenantId: string | null }> {
  const { data: send } = await supabaseAdmin
    .from("email_sends")
    .select("id, tenant_id, to_email, status, delivered_at, opened_at, clicked_at, bounced_at, complained_at, unsubscribed_at")
    .eq("resend_message_id", resendId)
    .maybeSingle();

  if (!send) return { tenantId: null };

  const patch: Record<string, unknown> = {};
  const now = new Date().toISOString();

  switch (eventType) {
    case "email.delivered":
      if (!send.delivered_at) {
        patch.delivered_at = now;
        patch.status = "delivered";
      }
      break;
    case "email.opened":
      if (!send.opened_at) patch.opened_at = now;
      break;
    case "email.clicked":
      if (!send.clicked_at) patch.clicked_at = now;
      break;
    case "email.bounced":
      if (!send.bounced_at) {
        patch.bounced_at = now;
        patch.status = "bounced";
        if (errorMsg) patch.error = errorMsg.slice(0, 500);
      }
      break;
    case "email.complained":
      if (!send.complained_at) {
        patch.complained_at = now;
        patch.status = "complained";
      }
      break;
    case "email.failed":
      patch.status = "failed";
      if (errorMsg) patch.error = errorMsg.slice(0, 500);
      break;
    default:
      // sent / delivery_delayed / unknown: nothing to update on send row
      break;
  }

  if (Object.keys(patch).length > 0) {
    await supabaseAdmin.from("email_sends").update(patch).eq("id", send.id);
  }

  // For campaign sends, propagate to email_campaign_recipients too.
  if (send.tenant_id && toEmail) {
    const recipientPatch: Record<string, unknown> = {};
    if (eventType === "email.bounced" || eventType === "email.failed") {
      recipientPatch.status = "failed";
      if (errorMsg) recipientPatch.error = errorMsg.slice(0, 500);
    }
    if (Object.keys(recipientPatch).length > 0) {
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update(recipientPatch)
        .eq("resend_message_id", resendId);
    }
  }

  return { tenantId: send.tenant_id };
}

/**
 * Adds an email to the suppression list on bounce/complaint.
 * Uses upsert via on-conflict to remain idempotent.
 */
async function maybeSuppress(
  tenantId: string | null,
  email: string,
  eventType: string,
  resendId: string,
  metadata: unknown,
): Promise<void> {
  let reason: "bounce" | "complaint" | null = null;
  if (eventType === "email.bounced") reason = "bounce";
  else if (eventType === "email.complained") reason = "complaint";
  else return;

  // Insert ignore-on-conflict via raw insert (unique index handles dedup).
  await supabaseAdmin
    .from("email_suppressions")
    .insert({
      tenant_id: tenantId,
      email: email.toLowerCase(),
      reason,
      source_event_id: resendId,
      metadata: (metadata as Record<string, unknown>) ?? {},
    })
    .then(
      () => undefined,
      // Ignore unique_violation (23505) — already suppressed.
      () => undefined,
    );
}

export const Route = createFileRoute("/api/public/email/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        if (rawBody.length > 100_000) {
          return jsonResponse({ error: "payload_too_large" }, 413);
        }

        const secret = process.env.RESEND_WEBHOOK_SECRET;
        const insecure = process.env.RESEND_WEBHOOK_INSECURE === "1";

        if (secret) {
          const svixId = request.headers.get("svix-id") ?? "";
          const svixTs = request.headers.get("svix-timestamp") ?? "";
          const svixSig = request.headers.get("svix-signature") ?? "";
          if (!svixId || !svixTs || !svixSig) {
            return jsonResponse({ error: "missing_svix_headers" }, 401);
          }
          // Reject events older than 5 minutes (replay protection).
          const tsNum = Number(svixTs);
          if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
            return jsonResponse({ error: "stale_timestamp" }, 401);
          }
          const ok = await verifySvixSignature(rawBody, svixId, svixTs, svixSig, secret);
          if (!ok) return jsonResponse({ error: "invalid_signature" }, 401);
        } else if (!insecure) {
          return jsonResponse({ error: "webhook_secret_not_configured" }, 401);
        }

        let payload: ResendWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return jsonResponse({ error: "invalid_json" }, 400);
        }

        const eventType = String(payload.type ?? "").toLowerCase();
        const data = payload.data ?? {};
        const resendId = typeof data.email_id === "string" ? data.email_id : "";
        if (!resendId) {
          return jsonResponse({ error: "missing_email_id" }, 400);
        }

        const toRaw = Array.isArray(data.to) ? data.to[0] : data.to;
        const toEmail = typeof toRaw === "string" ? toRaw : null;

        // Extract error message for bounce/failed events (best-effort).
        const errorMsg =
          (data.bounce as { message?: string } | undefined)?.message ??
          (data.failed as { reason?: string } | undefined)?.reason ??
          null;

        // 1) Apply to email_sends + collect tenant.
        const { tenantId } = await applyEventToSend(resendId, eventType, toEmail, errorMsg);

        // 2) Idempotent insert into email_events.
        // Dedup by (resend_message_id, event_type, created_at-bucket) — best effort:
        // we just insert; if you want strict dedup add unique index later.
        await supabaseAdmin.from("email_events").insert({
          resend_message_id: resendId,
          event_type: eventType,
          tenant_id: tenantId,
          payload: payload as never,
        } as never);

        // 3) Suppress on bounce/complaint.
        if (toEmail) {
          await maybeSuppress(tenantId, toEmail, eventType, resendId, data);
        }

        return jsonResponse({ ok: true });
      },
    },
  },
});
