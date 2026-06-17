/**
 * Smart Webhook System — автоматичні вебхуки для зовнішніх інтеграцій.
 *
 * Підтримувані вебхуки:
 * 1. Order Created — нове замовлення
 * 2. Order Paid — оплата замовлення
 * 3. Customer Created — новий клієнт
 * 4. Product Updated — оновлення товару
 * 5. Low Stock — низький запас
 *
 * Налаштування: кожен тенант може додати URL для кожного типу.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WebhookConfig = {
  tenant_id: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
};

/**
 * Надіслати вебхук.
 */
export async function sendWebhook(
  tenantId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; sent: number; failed: number }> {
  // Отримати вебхуки для цього типу події
  const { data: webhooks } = await supabaseAdmin
    .from("webhooks")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .contains("events", [event]);

  if (!webhooks || webhooks.length === 0) {
    return { ok: true, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const wh of webhooks) {
    try {
      const signature = await signPayload(wh.secret, payload);
      const res = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MARQ-Event": event,
          "X-MARQ-Signature": signature,
        },
        body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { ok: failed === 0, sent, failed };
}

/**
 * Підписати payload для верифікації.
 */
async function signPayload(secret: string, payload: Record<string, unknown>): Promise<string> {
  // HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Зареєструвати вебхук.
 */
export async function registerWebhook(
  tenantId: string,
  url: string,
  events: string[],
): Promise<{ ok: boolean; secret: string }> {
  const secret = crypto.randomUUID();

  const { error } = await supabaseAdmin.from("webhooks").insert({
    tenant_id: tenantId,
    url,
    events,
    secret,
    enabled: true,
  });

  return { ok: !error, secret };
}
