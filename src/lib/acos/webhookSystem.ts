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
  const { data: rows } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "webhook");

  const webhooks = (rows ?? [])
    .map((r) => (r.value ?? {}) as Record<string, unknown>)
    .filter((v) => v.enabled && Array.isArray(v.events) && (v.events as string[]).includes(event));

  if (webhooks.length === 0) return { ok: true, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const wh of webhooks) {
    try {
      const signature = await signPayload((wh.secret as string) ?? "", payload);
      const res = await fetch(wh.url as string, {
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

  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `webhook_${tenantId}_${Buffer.from(url).toString("base64").slice(0, 32)}`,
      fact_kind: "webhook",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "webhook_system",
      value: { url, events, secret, enabled: true } as never,
    });

  return { ok: !error, secret };
}
