/**
 * Email Winback Agent (Sprint 6).
 *
 * Шукає клієнтів, які попадають в категорію "сплять":
 *  - lifecycle_stage IN ('at_risk', 'dormant'),
 *  - consent_marketing = true,
 *  - last_order_at: 60..180 днів тому,
 *  - не отримували жодного email за останні 14 днів (анти-спам),
 *  - не отримували winback-лист за останні 60 днів.
 *
 * Для кожного:
 *  - генерує унікальний промокод WINBACK-XXXXXX (10%, 7 днів),
 *  - вставляє у `promotions`,
 *  - надсилає email winback з кодом.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  jsonError,
  jsonOk,
  startAgentRun,
} from "@/lib/acos/agentRuntime";
import { sendEmailViaGateway } from "@/lib/email/resendGateway";
import { renderWinback } from "@/lib/email/marketingTemplates";
import { isEmailAutomationEnabled } from "@/lib/acos/emailAutomationFlags";

const AGENT_ID = "email_winback";
const TEMPLATE = "winback";
const DISCOUNT_PCT = 10;
const PROMO_VALIDITY_DAYS = 7;
const ANTI_SPAM_DAYS = 14;
const WINBACK_DEDUP_DAYS = 60;
const MIN_DAYS_DORMANT = 60;
const MAX_DAYS_DORMANT = 180;
const BATCH_LIMIT = 50;

function appBase(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://e-marq.lovable.app"
  ).replace(/\/+$/, "");
}

function generatePromoCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "WINBACK-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const Route = createFileRoute("/hooks/agents/email-winback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json()) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          if (!(await isEmailAutomationEnabled(tenantId, "winback"))) {
            await finishAgentRun(handle, 0, { reason: "disabled_by_owner" });
            return jsonOk({ insights_created: 0, sent: 0, reason: "disabled_by_owner" });
          }
          const now = Date.now();
          const dayMs = 86_400_000;
          const minLastOrder = new Date(now - MAX_DAYS_DORMANT * dayMs).toISOString();
          const maxLastOrder = new Date(now - MIN_DAYS_DORMANT * dayMs).toISOString();

          const [{ data: tenant }, { data: cfg }] = await Promise.all([
            supabaseAdmin.from("tenants").select("slug, name").eq("id", tenantId).maybeSingle(),
            supabaseAdmin
              .from("tenant_configs")
              .select("brand_name")
              .eq("tenant_id", tenantId)
              .maybeSingle(),
          ]);
          if (!tenant) {
            await finishAgentRun(handle, 0, { reason: "no_tenant" });
            return jsonOk({ insights_created: 0, sent: 0 });
          }
          const brandName = cfg?.brand_name ?? tenant.name ?? "Store";
          const storeUrl = `${appBase()}/s/${encodeURIComponent(tenant.slug)}`;

          const { data: candidates } = await supabaseAdmin
            .from("customers")
            .select(
              "id, email, name, last_order_at, consent_marketing, unsubscribe_token, lifecycle_stage",
            )
            .eq("tenant_id", tenantId)
            .eq("consent_marketing", true)
            .in("lifecycle_stage", ["at_risk", "dormant"])
            .not("email", "is", null)
            .gte("last_order_at", minLastOrder)
            .lte("last_order_at", maxLastOrder)
            .limit(BATCH_LIMIT);

          if (!candidates?.length) {
            await finishAgentRun(handle, 0, { reason: "no_candidates" });
            return jsonOk({ insights_created: 0, sent: 0 });
          }

          const emails = candidates.map((c) => c.email!).filter(Boolean);
          // Anti-spam: будь-який email за 14 днів
          const antiSpamSince = new Date(now - ANTI_SPAM_DAYS * dayMs).toISOString();
          const { data: recentAny } = await supabaseAdmin
            .from("email_sends")
            .select("to_email")
            .eq("tenant_id", tenantId)
            .eq("status", "sent")
            .gte("created_at", antiSpamSince)
            .in("to_email", emails);
          const recentAnySet = new Set((recentAny ?? []).map((r) => r.to_email.toLowerCase()));

          // Winback dedup: 60 днів
          const winbackSince = new Date(now - WINBACK_DEDUP_DAYS * dayMs).toISOString();
          const { data: recentWb } = await supabaseAdmin
            .from("email_sends")
            .select("to_email")
            .eq("tenant_id", tenantId)
            .eq("template", TEMPLATE)
            .eq("status", "sent")
            .gte("created_at", winbackSince)
            .in("to_email", emails);
          const recentWbSet = new Set((recentWb ?? []).map((r) => r.to_email.toLowerCase()));

          let sent = 0;
          let skipped = 0;
          for (const c of candidates) {
            const email = c.email!.toLowerCase();
            if (recentAnySet.has(email) || recentWbSet.has(email)) {
              skipped++;
              continue;
            }
            if (!c.last_order_at) {
              skipped++;
              continue;
            }
            const daysSince = Math.floor((now - new Date(c.last_order_at).getTime()) / dayMs);

            // Створюємо унікальний промокод (повторюємо до 5 разів якщо collision)
            let code = "";
            let promoId: string | null = null;
            const expiresAt = new Date(now + PROMO_VALIDITY_DAYS * dayMs).toISOString();
            for (let attempt = 0; attempt < 5 && !promoId; attempt++) {
              const candidateCode = generatePromoCode();
              const { data: inserted, error } = await supabaseAdmin
                .from("promotions")
                .insert({
                  tenant_id: tenantId,
                  code: candidateCode,
                  name: `Winback −${DISCOUNT_PCT}% (${c.name ?? c.email})`,
                  promo_type: "percent_off",
                  value: DISCOUNT_PCT,
                  starts_at: new Date(now).toISOString(),
                  ends_at: expiresAt,
                  usage_limit: 1,
                  usage_per_customer: 1,
                  is_active: true,
                  agent: AGENT_ID,
                })
                .select("id, code")
                .maybeSingle();
              if (!error && inserted) {
                code = inserted.code ?? candidateCode;
                promoId = inserted.id;
              }
            }
            if (!promoId) {
              skipped++;
              continue;
            }

            const unsubUrl = `${appBase()}/api/public/email/unsubscribe?t=${encodeURIComponent(c.unsubscribe_token)}`;
            const { subject, html, text } = renderWinback({
              brandName,
              storeUrl,
              customerName: c.name,
              promoCode: code,
              discountPct: DISCOUNT_PCT,
              expiresAt,
              daysSinceLastOrder: daysSince,
              unsubscribeUrl: unsubUrl,
            });

            const result = await sendEmailViaGateway({
              to: c.email!,
              subject,
              html,
              text,
              fromName: brandName,
              tenantId,
              category: "marketing",
              unsubscribeToken: c.unsubscribe_token,
              tags: [
                { name: "template", value: TEMPLATE },
                { name: "tenant", value: tenantId.slice(0, 16) },
              ],
            });

            const { error: sendLogErr } = await supabaseAdmin.from("email_sends").insert({
              tenant_id: tenantId,
              to_email: c.email!,
              template: TEMPLATE,
              subject,
              status: result.ok ? "sent" : "failed",
              resend_message_id: result.ok ? result.id : null,
              error: result.ok ? null : result.error,
              metadata: { promo_id: promoId, promo_code: code, customer_id: c.id },
            });
            if (sendLogErr) console.error("[email-winback] email_sends insert failed:", sendLogErr.message);

            recentAnySet.add(email);
            recentWbSet.add(email);
            if (result.ok) sent++;
          }

          await finishAgentRun(handle, 0, { sent, skipped, considered: candidates.length });
          return jsonOk({ insights_created: 0, sent, skipped, considered: candidates.length });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Email winback failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
