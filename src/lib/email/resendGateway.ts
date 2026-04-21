/**
 * Уніфікована відправка email через Resend connector gateway (Lovable).
 *
 * Використовуйте ВИКЛЮЧНО на сервері (server routes / hooks) — потрібні
 * LOVABLE_API_KEY та RESEND_API_KEY (інʼєктуються конектором).
 *
 * Не плутати: тут "RESEND_API_KEY" — це ключ зʼєднання з Lovable gateway,
 * а НЕ напряму з api.resend.com.
 */
const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const DEFAULT_FROM = "onboarding@resend.dev";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export async function sendEmailViaGateway(input: SendEmailInput): Promise<SendEmailResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY not configured" };
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY not configured (Resend connector not linked)" };

  const to = String(input.to ?? "").trim();
  if (!isValidEmail(to)) return { ok: false, error: `Invalid recipient email: ${to}` };

  const subject = String(input.subject ?? "").trim().slice(0, 200);
  if (!subject) return { ok: false, error: "Subject is required" };

  const html = String(input.html ?? "");
  if (!html.trim()) return { ok: false, error: "HTML body is required" };

  const fromEmail = (input.fromEmail ?? DEFAULT_FROM).trim();
  const fromHeader = input.fromName
    ? `${input.fromName.replace(/[<>]/g, "")} <${fromEmail}>`
    : fromEmail;

  const body: Record<string, unknown> = {
    from: fromHeader,
    to: [to],
    subject,
    html,
  };
  if (input.text) body.text = input.text;
  if (input.replyTo && isValidEmail(input.replyTo)) body.reply_to = input.replyTo;
  if (input.tags && input.tags.length > 0) body.tags = input.tags.slice(0, 8);

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
