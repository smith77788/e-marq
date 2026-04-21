/**
 * GET/POST /api/public/email/unsubscribe?t=<unsubscribe_token>
 *
 * Публічна сторінка/endpoint для one-click відписки (List-Unsubscribe).
 *
 *  - GET: повертає просту HTML-сторінку з підтвердженням
 *  - POST: вмикає consent_marketing=false, додає email в email_suppressions
 *
 * Token = customers.unsubscribe_token (UUID, unique).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function htmlPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;margin:0;padding:48px 16px;color:#0f172a}
.card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;line-height:1.5;font-size:14px;margin:0 0 16px}
button{background:#0f172a;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer}
.muted{color:#94a3b8;font-size:12px;margin-top:24px}</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function lookupCustomer(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await supabaseAdmin
    .from("customers")
    .select("id, tenant_id, email, name, consent_marketing")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  return data;
}

export const Route = createFileRoute("/api/public/email/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("t") ?? "";
        const c = await lookupCustomer(token);
        if (!c || !c.email) {
          return htmlPage(
            "Посилання недійсне",
            `<h1>Посилання недійсне</h1><p>Це посилання для відписки не існує або вже використане.</p>`,
            404,
          );
        }
        if (!c.consent_marketing) {
          return htmlPage(
            "Ви вже відписані",
            `<h1>Ви вже відписані</h1><p><strong>${c.email}</strong> більше не отримує маркетингові листи.</p>`,
          );
        }
        return htmlPage(
          "Відписатися від розсилки",
          `<h1>Відписатися від розсилки?</h1>
<p>Натисніть кнопку нижче, щоб <strong>${c.email}</strong> більше не отримував листи з розсилок. Транзакційні листи (підтвердження замовлення тощо) будуть надсилатись надалі.</p>
<form method="POST" action="/api/public/email/unsubscribe?t=${encodeURIComponent(token)}"><button type="submit">Так, відписатися</button></form>
<p class="muted">Якщо ви передумаєте — звʼяжіться зі службою підтримки магазину.</p>`,
        );
      },

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("t") ?? "";
        const c = await lookupCustomer(token);
        if (!c || !c.email) {
          return htmlPage(
            "Посилання недійсне",
            `<h1>Посилання недійсне</h1><p>Це посилання для відписки не існує або вже використане.</p>`,
            404,
          );
        }

        const now = new Date().toISOString();
        await Promise.all([
          supabaseAdmin
            .from("customers")
            .update({ consent_marketing: false })
            .eq("id", c.id),
          supabaseAdmin
            .from("email_suppressions")
            .insert({
              tenant_id: c.tenant_id,
              email: c.email.toLowerCase(),
              reason: "unsubscribe",
              source_event_id: token,
              metadata: { customer_id: c.id, unsubscribed_at: now },
            })
            .then(
              () => undefined,
              () => undefined,
            ),
          supabaseAdmin
            .from("email_sends")
            .update({ unsubscribed_at: now })
            .eq("tenant_id", c.tenant_id)
            .ilike("to_email", c.email)
            .is("unsubscribed_at", null),
        ]);

        return htmlPage(
          "Відписку оформлено",
          `<h1>Готово</h1><p><strong>${c.email}</strong> більше не отримуватиме маркетингові листи.</p>
<p class="muted">Транзакційні листи (підтвердження замовлення, статуси) будуть надсилатись як зазвичай.</p>`,
        );
      },
    },
  },
});
