/**
 * Smart Email Automation — автоматичні email-ланцюжки для відновлення виручки.
 *
 * Ланцюжки:
 * 1. Cart Abandonment — 3 нагадування (1ч → 24ч → 72ч)
 * 2. Winback — персоналізоване повідомлення через 60 днів
 * 3. Post-Purchase — запит відгуку + cross-sell через 7 днів
 * 4. VIP Treatment — персональні пропозиції для топ-клієнтів
 * 5. Price Drop Alert — сповіщення про знижку на обраний товар
 *
 * Всі ланцюжки використовують MiMo Code для генерації контенту.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiChat, isAnyAiEnabled } from "./aiGateway";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";

export type EmailSequence = {
  id: string;
  name: string;
  trigger: string;
  emails: EmailStep[];
};

type EmailStep = {
  delay_hours: number;
  subject_template: string;
  body_template: string;
  ai_personalized: boolean;
};

type EmailContext = {
  customer_name: string;
  customer_email: string;
  brand_name: string;
  product_name?: string;
  cart_total?: number;
  discount_code?: string;
  days_since_order?: number;
  last_product?: string;
};

// ─── Готові ланцюжки ─────────────────────────────────────────

export const CART_ABANDONMENT_SEQUENCE: EmailSequence = {
  id: "cart_abandonment",
  name: "Покинутий кошик",
  trigger: "checkout_started → no purchase within 1h",
  emails: [
    {
      delay_hours: 1,
      subject_template: "Ваш кошик чекає 🛒",
      body_template: "Нагадуємо про товари у кошику. Оформіть замовлення зараз!",
      ai_personalized: false,
    },
    {
      delay_hours: 23,
      subject_template: "Майже готово! Залишився один крок",
      body_template: "Ваші товари все ще в наявності, але запаси обмежені.",
      ai_personalized: true,
    },
    {
      delay_hours: 48,
      subject_template: "Останній шанс — знижка 5% на кошик",
      body_template: "Спеціальна пропозиція для вашого кошика. Діє 24 години.",
      ai_personalized: true,
    },
  ],
};

export const WINBACK_SEQUENCE: EmailSequence = {
  id: "winback",
  name: "Повернення клієнта",
  trigger: "last_order > 60 days",
  emails: [
    {
      delay_hours: 0,
      subject_template: "Сумуємо за вами! 💛",
      body_template: "Давно не бачились. Ось що нового у нас.",
      ai_personalized: true,
    },
    {
      delay_hours: 72,
      subject_template: "Персональна пропозиція для вас",
      body_template: "Ми підготували щось особливе саме для вас.",
      ai_personalized: true,
    },
  ],
};

export const POST_PURCHASE_SEQUENCE: EmailSequence = {
  id: "post_purchase",
  name: "Після покупки",
  trigger: "order_paid",
  emails: [
    {
      delay_hours: 168, // 7 днів
      subject_template: "Як вам товар?",
      body_template: "Поділіться враженнями — нам важлива ваша думка.",
      ai_personalized: false,
    },
    {
      delay_hours: 336, // 14 днів
      subject_template: "Щось схоже на ваш смак?",
      body_template: "Ми підібрали товари, які вам сподобаються.",
      ai_personalized: true,
    },
  ],
};

// ─── Генерація контенту ──────────────────────────────────────

async function generatePersonalizedSubject(
  baseSubject: string,
  ctx: EmailContext,
): Promise<string> {
  if (!isAnyAiEnabled()) return baseSubject;

  const result = await aiChat({
    system: `You are a copywriter for "${ctx.brand_name}". Rewrite this email subject to be more personal and engaging. Keep it under 50 characters. Use the customer's first name. Be warm but not pushy.`,
    user: `Base subject: "${baseSubject}"\nCustomer: ${ctx.customer_name}\nContext: ${ctx.product_name ? `Viewed ${ctx.product_name}` : ctx.days_since_order ? `${ctx.days_since_order} days since last order` : "General"}`,
    temperature: 0.7,
  });

  return result.content?.slice(0, 50) ?? baseSubject;
}

async function generatePersonalizedBody(
  baseBody: string,
  ctx: EmailContext,
): Promise<string> {
  if (!isAnyAiEnabled()) return baseBody;

  const result = await aiChat({
    system: `You are a friendly D2C brand "${ctx.brand_name}". Write a SHORT (2-3 sentences) personalized email body. Be warm, specific, and action-oriented. Never use words like "discount" or "sale" — use "special offer" or "just for you".`,
    user: `Base: "${baseBody}"\nCustomer: ${ctx.customer_name}\n${ctx.product_name ? `Last product: ${ctx.product_name}` : ""}\n${ctx.cart_total ? `Cart value: ${ctx.cart_total} UAH` : ""}\n${ctx.discount_code ? `Discount code: ${ctx.discount_code}` : ""}`,
    temperature: 0.6,
  });

  return result.content ?? baseBody;
}

// ─── Відправка ───────────────────────────────────────────────

export async function sendAutomatedEmail(
  tenantId: string,
  sequence: EmailSequence,
  stepIndex: number,
  ctx: EmailContext,
): Promise<{ ok: boolean; error?: string }> {
  const step = sequence.emails[stepIndex];
  if (!step) return { ok: false, error: "Invalid step index" };

  // Отримати email налаштування тенанта
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const features = (config?.features ?? {}) as Record<string, unknown>;
  const emailConfig = (features.email ?? {}) as Record<string, unknown>;
  const fromEmail = (emailConfig.from_email as string) || `noreply@${ctx.brand_name.toLowerCase().replace(/\s/g, "")}.com`;
  const fromName = (emailConfig.from_name as string) || ctx.brand_name;

  // Згенерувати персоналізований контент
  let subject = step.subject_template;
  let body = step.body_template;

  if (step.ai_personalized) {
    [subject, body] = await Promise.all([
      generatePersonalizedSubject(step.subject_template, ctx),
      generatePersonalizedBody(step.body_template, ctx),
    ]);
  }

  // Додати discount code якщо є
  if (ctx.discount_code) {
    body += `\n\nВаш код: ${ctx.discount_code}`;
  }

  // Записати в чергу відправки
  const { error } = await supabaseAdmin.from("outbound_messages").insert({
    tenant_id: tenantId,
    channel: "email",
    trigger_kind: `automation.${sequence.id}`,
    template_key: `${sequence.id}.step${stepIndex}`,
    body: JSON.stringify({ subject, html: body }),
    status: "pending",
    metadata: {
      sequence_id: sequence.id,
      step_index: stepIndex,
      customer_email: ctx.customer_email,
      customer_name: ctx.customer_name,
    },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Запустити автоматичний ланцюжок для клієнта.
 */
export async function triggerEmailSequence(
  tenantId: string,
  sequenceId: string,
  ctx: EmailContext,
): Promise<{ ok: boolean; scheduled: number; error?: string }> {
  const sequences: Record<string, EmailSequence> = {
    cart_abandonment: CART_ABANDONMENT_SEQUENCE,
    winback: WINBACK_SEQUENCE,
    post_purchase: POST_PURCHASE_SEQUENCE,
  };

  const sequence = sequences[sequenceId];
  if (!sequence) return { ok: false, scheduled: 0, error: "Unknown sequence" };

  let scheduled = 0;
  for (let i = 0; i < sequence.emails.length; i++) {
    const result = await sendAutomatedEmail(tenantId, sequence, i, ctx);
    if (result.ok) scheduled++;
  }

  return { ok: scheduled > 0, scheduled };
}
