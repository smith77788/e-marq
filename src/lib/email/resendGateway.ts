/**
 * Уніфікована відправка email через Resend connector gateway (Lovable).
 *
 * Використовуйте ВИКЛЮЧНО на сервері (server routes / hooks) — потрібні
 * LOVABLE_API_KEY та RESEND_API_KEY (інʼєктуються конектором).
 *
 * Не плутати: тут "RESEND_API_KEY" — це ключ зʼєднання з Lovable gateway,
 * а НЕ напряму з api.resend.com.
 *
 * Sprint 4 розширення:
 *  - per-tenant from/from_name/reply_to з tenant_configs.features.email_settings,
 *  - перевірка suppression-списку (bounce/complaint/unsubscribe),
 *  - List-Unsubscribe + List-Unsubscribe-Post headers (RFC 8058 one-click).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const DEFAULT_FROM = "onboarding@resend.dev";
const DEFAULT_FROM_NAME = "MARQ";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
  /**
   * Tenant scope. Якщо передано, gateway:
   *   - підвантажує per-tenant from/from_name/reply_to з email_settings,
   *   - перевіряє suppression-список,
   *   - додає List-Unsubscribe header (якщо є customer-токен — див. unsubscribeToken).
   */
  tenantId?: string;
  /**
   * Якщо лист маркетинговий, передайте customer.unsubscribe_token —
   * додамо List-Unsubscribe / List-Unsubscribe-Post headers і
   * проігноруємо адресу, якщо клієнт уже відписаний.
   */
  unsubscribeToken?: string;
  /**
   * Категорія: "transactional" пропускає suppression-списку для unsubscribe
   * (але bounce/complaint все одно блокують). За замовчуванням "transactional".
   */
  category?: "transactional" | "marketing";
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; suppressed?: boolean };

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

type TenantEmailSettings = {
  domain?: string;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  resend_status?: string;
};

async function loadTenantEmailSettings(
  tenantId: string,
): Promise<TenantEmailSettings | null> {
  const { data } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const features = (data?.features as Record<string, unknown> | null) ?? {};
  const settings = features.email_settings as TenantEmailSettings | undefined;
  return settings ?? null;
}

/**
 * Перевіряє, чи є email у suppression-списку для tenant'а (або глобально).
 * Для marketing-листів — блокує bounce/complaint/unsubscribe.
 * Для transactional — блокує лише bounce/complaint (відписка не зупиняє
 * підтвердження замовлення).
 */
async function isSuppressed(
  tenantId: string,
  email: string,
  category: "transactional" | "marketing",
): Promise<boolean> {
  const reasons =
    category === "marketing"
      ? ["bounce", "complaint", "unsubscribe", "manual"]
      : ["bounce", "complaint", "manual"];

  const { data } = await supabaseAdmin
    .from("email_suppressions")
    .select("id")
    .ilike("email", email)
    .in("reason", reasons)
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    .limit(1);
  return Boolean(data && data.length > 0);
}

function buildUnsubscribeUrl(token: string): string {
  const base =
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://e-marq.lovable.app";
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/api/public/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

export async function sendEmailViaGateway(input: SendEmailInput): Promise<SendEmailResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY not configured" };
  if (!resendKey)
    return { ok: false, error: "RESEND_API_KEY not configured (Resend connector not linked)" };

  const to = String(input.to ?? "").trim();
  if (!isValidEmail(to)) return { ok: false, error: `Invalid recipient email: ${to}` };

  const subject = String(input.subject ?? "").trim().slice(0, 200);
  if (!subject) return { ok: false, error: "Subject is required" };

  const html = String(input.html ?? "");
  if (!html.trim()) return { ok: false, error: "HTML body is required" };

  const category = input.category ?? "transactional";

  // Resolve per-tenant settings (overridable by explicit input.fromEmail/fromName).
  let tenantSettings: TenantEmailSettings | null = null;
  if (input.tenantId) {
    tenantSettings = await loadTenantEmailSettings(input.tenantId);

    // Suppression check.
    if (await isSuppressed(input.tenantId, to, category)) {
      return { ok: false, error: `Recipient ${to} is on suppression list`, suppressed: true };
    }
  }

  // Choose from address: explicit > tenant verified > default fallback.
  // We only use tenant's from_email if domain is verified — otherwise Resend
  // would reject it. Fall back to onboarding@resend.dev (works without verification).
  const tenantFromOk =
    tenantSettings?.resend_status === "verified" &&
    tenantSettings.from_email &&
    isValidEmail(tenantSettings.from_email);

  const fromEmail = (
    input.fromEmail ||
    (tenantFromOk ? tenantSettings!.from_email : null) ||
    DEFAULT_FROM
  ).trim();

  const fromName = (
    input.fromName ||
    tenantSettings?.from_name ||
    DEFAULT_FROM_NAME
  ).trim();

  const fromHeader = fromName
    ? `${fromName.replace(/[<>]/g, "")} <${fromEmail}>`
    : fromEmail;

  const replyTo = input.replyTo || tenantSettings?.reply_to || "";

  // Build headers (List-Unsubscribe for one-click unsubscribe, RFC 8058).
  const headers: Record<string, string> = {};
  if (input.unsubscribeToken) {
    const unsubUrl = buildUnsubscribeUrl(input.unsubscribeToken);
    headers["List-Unsubscribe"] = `<${unsubUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const body: Record<string, unknown> = {
    from: fromHeader,
    to: [to],
    subject,
    html,
  };
  if (input.text) body.text = input.text;
  if (replyTo && isValidEmail(replyTo)) body.reply_to = replyTo;
  if (input.tags && input.tags.length > 0) body.tags = input.tags.slice(0, 8);
  if (Object.keys(headers).length > 0) body.headers = headers;

  let res: Response;
  try {
    res = await fetch(`${RESEND_GATEWAY}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : String(e)}` };
  }

  let json: { id?: string; message?: string; name?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* ignore */
  }

  if (!res.ok || !json.id) {
    const msg = json.message ?? json.name ?? `HTTP ${res.status}`;
    return { ok: false, error: `Resend gateway: ${msg}` };
  }
  return { ok: true, id: json.id };
}
