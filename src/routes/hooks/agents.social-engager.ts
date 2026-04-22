/**
 * Lead Agent: Social Engager
 *
 * Готує безкоштовні «торкання» (outreach) до prospect'ів. Не надсилає
 * листи самостійно — записує draft у `lead_outreach` (status=queued),
 * щоб супер-адмін одним кліком підтвердив або відредагував.
 *
 * Якщо передано `prospect_id`, опрацьовує лише його; інакше підбирає
 * до 20 кандидатів зі статусом `discovered`/`qualified` без свіжих торкань.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeLeadAgent } from "@/lib/lead/auth";

type Prospect = {
  id: string;
  name: string;
  niche: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  email: string | null;
  signals: Record<string, unknown>;
};

function pickChannel(p: Prospect): { channel: string; intent: string } {
  if (p.email) return { channel: "email", intent: "first_touch" };
  if (p.instagram_handle) return { channel: "instagram_dm", intent: "first_touch" };
  return { channel: "web_form", intent: "first_touch" };
}

function craftMessage(p: Prospect): { subject: string; body: string; cta: string } {
  const niche = p.niche ?? "ваш магазин";
  const subject = `Як ${p.name} може зростати на 30% з MARQ`;
  const body = [
    `Привіт, команда ${p.name}!`,
    ``,
    `Я тестую безкоштовний AI-помічник MARQ для брендів у ніші «${niche}».`,
    `Він автоматично відновлює покинуті кошики, повертає клієнтів,`,
    `пише SEO-описи й тримає Telegram/Email-розсилки на автопілоті.`,
    ``,
    `Хочете 14 днів безкоштовно — без передоплати, без карти?`,
    `Реєстрація — 60 секунд: https://marq.lovable.app/signup`,
    ``,
    `— команда MARQ`,
  ].join("\n");
  return { subject, body, cta: "https://marq.lovable.app/signup" };
}

async function loadOne(id: string): Promise<Prospect | null> {
  const { data } = await supabaseAdmin
    .from("lead_prospects")
    .select("id, name, niche, website_url, instagram_handle, email, signals")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Prospect) ?? null;
}

async function loadBatch(): Promise<Prospect[]> {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("lead_prospects")
    .select("id, name, niche, website_url, instagram_handle, email, signals")
    .in("status", ["discovered", "qualified"])
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${since}`)
    .order("fit_score", { ascending: false })
    .limit(20);
  return (data as unknown as Prospect[]) ?? [];
}

export const Route = createFileRoute("/hooks/agents/social-engager")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeLeadAgent(request);
        if ("error" in auth) return jsonError(auth.error, auth.status);

        let body: { prospect_id?: string } = {};
        try {
          body = (await request.json()) as { prospect_id?: string };
        } catch {
          /* empty body — batch mode */
        }

        const prospects = body.prospect_id
          ? ([await loadOne(body.prospect_id)].filter(Boolean) as Prospect[])
          : await loadBatch();

        let created = 0;
        for (const p of prospects) {
          const { channel, intent } = pickChannel(p);
          const msg = craftMessage(p);
          const { error } = await supabaseAdmin.from("lead_outreach").insert({
            prospect_id: p.id,
            channel,
            intent,
            status: "queued",
            payload: {
              subject: msg.subject,
              body: msg.body,
              cta: msg.cta,
              recipient: p.email ?? p.instagram_handle ?? p.website_url,
            },
          });
          if (!error) {
            created += 1;
            await supabaseAdmin
              .from("lead_prospects")
              .update({ status: "engaging", last_contacted_at: new Date().toISOString() })
              .eq("id", p.id);
          }
        }

        return jsonOk({ ok: true, scanned: prospects.length, created });
      },
    },
  },
});
