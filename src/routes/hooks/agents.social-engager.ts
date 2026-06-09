/**
 * Lead Agent: Social Engager (brand-aware edition)
 *
 * Готує безкоштовні «торкання» (outreach) до prospect'ів. НЕ надсилає
 * листи самостійно — записує draft у `lead_outreach` (status=queued),
 * щоб супер-адмін одним кліком підтвердив або відредагував.
 *
 * Тепер копірайт підбирається під ГОЛОС І ТЕМАТИКУ КОЖНОГО ТЕНАНТА.
 * Якщо для prospect'a у `signals.discovered_for_tenant` записано тенант,
 * який його знайшов — outreach пишеться від імені того бренду. Інакше
 * береться перший активний тенант як «джерело».
 *
 * Якщо передано `prospect_id`, опрацьовує лише його; інакше підбирає
 * до 20 кандидатів зі статусом `discovered`/`qualified` без свіжих торкань.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeLeadAgent } from "@/lib/lead/auth";
import {
  getAllTenantBrandContexts,
  getTenantBrandContext,
  type TenantBrandContext,
} from "@/lib/lead/brandContext";

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

/** Знайти бренд-джерело для outreach: спочатку той, що знайшов prospect; інакше перший активний. */
async function pickSourceBrand(
  prospect: Prospect,
  contexts: TenantBrandContext[],
): Promise<TenantBrandContext | null> {
  const sigTenant =
    typeof prospect.signals?.discovered_for_tenant === "string"
      ? (prospect.signals.discovered_for_tenant as string)
      : null;
  if (sigTenant) {
    const fromCache = contexts.find((c) => c.tenant_id === sigTenant);
    if (fromCache) return fromCache;
    try {
      return await getTenantBrandContext(sigTenant);
    } catch {
      /* fall back below */
    }
  }
  return contexts[0] ?? null;
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

        const contexts = await getAllTenantBrandContexts();
        if (contexts.length === 0) {
          return jsonOk({
            ok: true,
            scanned: 0,
            created: 0,
            note: "Немає активних брендів-джерел. Додайте хоча б один бізнес, щоб писати outreach від його імені.",
          });
        }

        const prospects = body.prospect_id
          ? ([await loadOne(body.prospect_id)].filter(Boolean) as Prospect[])
          : await loadBatch();

        let created = 0;
        const perBrand: Record<string, number> = {};

        for (const p of prospects) {
          const source = await pickSourceBrand(p, contexts);
          if (!source) continue;

          const { channel, intent } = pickChannel(p);
          const subject = source.outreach.subject(p.name);
          const messageBody = source.outreach.body(p.name, p.niche);

          const { error } = await supabaseAdmin.from("lead_outreach").insert({
            prospect_id: p.id,
            channel,
            intent,
            status: "queued",
            payload: {
              subject,
              body: messageBody,
              cta: source.outreach.cta,
              recipient: p.email ?? p.instagram_handle ?? p.website_url,
              source_tenant_id: source.tenant_id,
              source_brand: source.profile.brand_name,
              tone: source.profile.tone,
            },
          });
          if (!error) {
            created += 1;
            perBrand[source.profile.brand_name] = (perBrand[source.profile.brand_name] ?? 0) + 1;
            const { error: statusErr } = await supabaseAdmin
              .from("lead_prospects")
              .update({ status: "engaging", last_contacted_at: new Date().toISOString() })
              .eq("id", p.id);
            if (statusErr)
              console.error("[social-engager] prospect status update failed:", statusErr.message);
          } else {
            console.error("[social-engager] lead_outreach insert failed:", error.message);
          }
        }

        return jsonOk({
          ok: true,
          scanned: prospects.length,
          created,
          per_brand: perBrand,
        });
      },
    },
  },
});
