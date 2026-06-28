/**
 * POST /api/email/campaign-send
 *
 * Створює (або відновлює) кампанію та починає відправку батчами.
 *
 * Body:
 * {
 *   tenantId: string;
 *   name: string;            // "Літня розпродажа"
 *   subject: string;
 *   html: string;            // готовий HTML листа (із unsubscribe плейсхолдером або без)
 *   segment?: "all" | "active" | "vip" | "lapsed";  // за замовчуванням "all"
 *   testEmail?: string;      // якщо задано — відправити тільки тестово на цей email і НЕ створювати кампанію
 * }
 *
 * Auth: Bearer JWT, ролі owner / admin / super_admin.
 *
 * Логіка:
 *  1) Авторизація + перевірка ролі.
 *  2) testEmail mode → один лист, без створення campaign.
 *  3) Виборка customers за segment з consent_marketing=true і email IS NOT NULL.
 *     Видаляємо тих, хто є в email_suppressions (bounce/complaint/unsubscribe).
 *  4) Створюємо email_campaigns + email_campaign_recipients (status='pending').
 *  5) Відправляємо батчем по 50 з пеллою 200ms між батчами (під limit 10 req/s Resend).
 *  6) Оновлюємо лічильники + status='sent'.
 *
 * Виконується синхронно: повертаємо результат після завершення.
 * Для великих списків (>2000) краще винести в фонову задачу — поки не потрібно.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";
import { clientIp, createIpRateLimiter } from "@/lib/http/rateLimit";

const MAX_RECIPIENTS = 5000;
const SEND_INTERVAL_MS = 125;
const MAX_RETRIES = 3;
const limiter = createIpRateLimiter({ limit: 5, windowMs: 60_000 });

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  html: z.string().min(20).max(200_000),
  segment: z.enum(["all", "active", "vip", "lapsed"]).default("all"),
  testEmail: z.string().email().optional(),
});

type Segment = "all" | "active" | "vip" | "lapsed";

async function authUser(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing_bearer" };
  const token = auth.slice(7).trim();
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "server_misconfigured" };
  const sb = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true, userId: String(data.claims.sub) };
}

async function userCanManageTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data: sa } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (sa) return true;
  const { data: m } = await supabaseAdmin
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return m?.role === "owner" || m?.role === "admin";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type CustomerRow = {
  id: string;
  email: string;
  name: string | null;
  unsubscribe_token: string;
  total_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  lifecycle_stage: string;
};

async function loadSegment(tenantId: string, segment: Segment): Promise<CustomerRow[]> {
  let q = supabaseAdmin
    .from("customers")
    .select(
      "id, email, name, unsubscribe_token, total_orders, total_spent_cents, last_order_at, lifecycle_stage",
    )
    .eq("tenant_id", tenantId)
    .eq("consent_marketing", true)
    .not("email", "is", null)
    .limit(MAX_RECIPIENTS);

  switch (segment) {
    case "active":
      q = q
        .gt("total_orders", 0)
        .gte("last_order_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
      break;
    case "vip":
      q = q.gte("total_spent_cents", 500_000); // ≥ 5 000 UAH
      break;
    case "lapsed":
      q = q
        .gt("total_orders", 0)
        .lt("last_order_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
      break;
    case "all":
    default:
      break;
  }

  const { data } = await q;
  return (data ?? []) as CustomerRow[];
}

async function filterSuppressed(tenantId: string, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { data } = await supabaseAdmin
    .from("email_suppressions")
    .select("email")
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    .in("reason", ["bounce", "complaint", "unsubscribe", "manual"]);
  return new Set((data ?? []).map((r) => (r.email ?? "").toLowerCase()));
}

function injectUnsubscribeFooter(html: string, unsubUrl: string, brand: string): string {
  // If template contains {{unsubscribe_url}} placeholder, replace it. Otherwise append a small footer.
  if (html.includes("{{unsubscribe_url}}")) {
    return html.replace(/\{\{unsubscribe_url\}\}/g, unsubUrl);
  }
  const footer = `<div style="margin-top:24px;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;">
Цей лист — від ${brand}. <a href="${unsubUrl}" style="color:#64748b;text-decoration:underline;">Відписатися</a>
</div>`;
  // Try to inject before </body>; otherwise append.
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${footer}</body>`);
  return html + footer;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(
  input: Parameters<typeof sendEmailViaGateway>[0],
  maxRetries = MAX_RETRIES,
): ReturnType<typeof sendEmailViaGateway> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    const result = await sendEmailViaGateway(input);
    if (result.ok) return result;
    // Retry on rate-limit (429) with exponential backoff; fail fast on other errors.
    if (result.error.includes("429") || result.error.toLowerCase().includes("rate")) {
      attempt++;
      if (attempt > maxRetries) return result;
      await delay(Math.pow(2, attempt) * 500);
    } else {
      return result;
    }
  }
  return { ok: false, error: "max_retries_exceeded" };
}

export const Route = createFileRoute("/api/email/campaign-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!limiter.check(ip)) {
          return jsonResponse({ error: "rate_limit_exceeded" }, 429);
        }

        const auth = await authUser(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        let parsed: z.infer<typeof BodySchema>;
        try {
          const raw = await request.json().catch(() => null);
          if (!raw) return jsonResponse({ error: "invalid_json" }, 400);
          parsed = BodySchema.parse(raw);
        } catch (err) {
          const msg = err instanceof z.ZodError
            ? err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
            : "invalid_body";
          return jsonResponse({ error: msg }, 400);
        }

        const { tenantId, name, subject, html, segment, testEmail = null } = parsed;

        if (!(await userCanManageTenant(auth.userId, tenantId))) {
          return jsonResponse({ error: "forbidden" }, 403);
        }

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("name")
          .eq("id", tenantId)
          .maybeSingle();
        const brandName = tenant?.name ?? "Магазин";

        // ---- TEST MODE ----
        if (testEmail) {
          const previewHtml = injectUnsubscribeFooter(
            html,
            "https://example.com/preview-unsubscribe",
            brandName,
          );
          const r = await sendEmailViaGateway({
            to: testEmail,
            subject: `[ТЕСТ] ${subject}`,
            html: previewHtml,
            tenantId,
            category: "marketing",
            tags: [
              { name: "campaign_test", value: "1" },
              { name: "tenant", value: tenantId.slice(0, 16) },
            ],
          });
          if (!r.ok) return jsonResponse({ ok: false, error: r.error }, 502);
          return jsonResponse({ ok: true, mode: "test", id: r.id });
        }

        // ---- REAL MODE ----
        const customers = await loadSegment(tenantId, segment);
        if (customers.length === 0) {
          return jsonResponse({ ok: false, error: "no_recipients" }, 400);
        }

        const emails = customers.map((c) => c.email.toLowerCase());
        const suppressed = await filterSuppressed(tenantId, emails);
        const eligible = customers.filter((c) => !suppressed.has(c.email.toLowerCase()));

        if (eligible.length === 0) {
          return jsonResponse({ ok: false, error: "all_suppressed" }, 400);
        }

        // Create campaign
        const { data: campaign, error: cErr } = await supabaseAdmin
          .from("email_campaigns")
          .insert({
            tenant_id: tenantId,
            name,
            subject,
            template: "broadcast",
            segment,
            status: "sending",
            recipients_count: eligible.length,
            metadata: {
              segment,
              eligible_count: eligible.length,
              suppressed_count: customers.length - eligible.length,
              total_pool: customers.length,
            },
          })
          .select("id")
          .single();

        if (cErr || !campaign) {
          return jsonResponse({ error: cErr?.message ?? "campaign_create_failed" }, 500);
        }
        const campaignId = campaign.id;

        // Pre-create recipient rows (so we have a record even if we crash mid-send).
        const { error: recipientsErr } = await supabaseAdmin.from("email_campaign_recipients").insert(
          eligible.map((c) => ({
            campaign_id: campaignId,
            tenant_id: tenantId,
            customer_id: c.id,
            to_email: c.email,
            status: "pending",
          })),
        );
        if (recipientsErr) {
          console.error("[campaign-send] failed to pre-create recipients:", recipientsErr.message);
          return jsonResponse({ error: "recipients_insert_failed" }, 500);
        }

        let sent = 0;
        let failed = 0;

        const appUrl = (
          process.env.PUBLIC_APP_URL ||
          process.env.VITE_PUBLIC_APP_URL ||
          "https://e-marq.lovable.app"
        ).replace(/\/+$/, "");

        for (let i = 0; i < eligible.length; i++) {
          const c = eligible[i];
          const unsubUrl = `${appUrl}/api/public/email/unsubscribe?t=${encodeURIComponent(c.unsubscribe_token)}`;
          const personalizedHtml = injectUnsubscribeFooter(html, unsubUrl, brandName);

          const result = await sendWithRetry({
            to: c.email,
            subject,
            html: personalizedHtml,
            tenantId,
            category: "marketing",
            unsubscribeToken: c.unsubscribe_token,
            tags: [
              { name: "campaign", value: campaignId.slice(0, 16) },
              { name: "tenant", value: tenantId.slice(0, 16) },
            ],
          });

          if (result.ok) {
            sent++;
            await Promise.all([
              supabaseAdmin
                .from("email_campaign_recipients")
                .update({
                  status: "sent",
                  sent_at: new Date().toISOString(),
                  resend_message_id: result.id,
                })
                .eq("campaign_id", campaignId)
                .eq("customer_id", c.id),
              supabaseAdmin.from("email_sends").insert({
                tenant_id: tenantId,
                to_email: c.email,
                template: "broadcast",
                subject,
                status: "sent",
                resend_message_id: result.id,
                campaign_id: campaignId,
              }),
            ]);
          } else {
            failed++;
            const errorMsg = (result.error ?? "unknown").slice(0, 500);
            const skipped = "suppressed" in result && result.suppressed;
            await supabaseAdmin
              .from("email_campaign_recipients")
              .update({
                status: skipped ? "skipped_suppressed" : "failed",
                error: errorMsg,
              })
              .eq("campaign_id", campaignId)
              .eq("customer_id", c.id);
          }

          // Throttle to stay under Resend's 10 req/s limit.
          if (i < eligible.length - 1) await delay(SEND_INTERVAL_MS);
        }

        await supabaseAdmin
          .from("email_campaigns")
          .update({
            status: failed === eligible.length ? "failed" : "sent",
            sent_at: new Date().toISOString(),
            recipients_count: sent,
          })
          .eq("id", campaignId);

        return jsonResponse({
          ok: true,
          campaign_id: campaignId,
          eligible: eligible.length,
          sent,
          failed,
          suppressed_skipped: customers.length - eligible.length,
        });
      },
    },
  },
});
