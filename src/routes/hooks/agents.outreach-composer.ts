/**
 * Outreach Composer — для нових leads генерує 2 драфти через Lovable AI Gateway,
 * створює outreach_actions у статусі pending_review.
 *
 * NOTE: У MARQ немає tribunal-cases таблиці, тому кейс не енкьюїться;
 * action одразу в pending_review для людської перевірки.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeOutreach, resolveTargetTenants } from "@/lib/outreach/auth";
import {
  getSettings,
  isBlocked,
  buildLandingUrl,
  buildUtmCampaign,
  generatePromoCode,
} from "@/lib/outreach/shared";
import { getChannelHints, type ChannelHints } from "@/lib/outreach/memory";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function fallbackDrafts(brandName: string, promo: string, landing: string) {
  return {
    primary:
      `Привіт! Якщо шукаєте перевірений варіант — ми робимо ${brandName.toLowerCase()} в Україні. ` +
      `Промокод ${promo} дає -10%: ${landing}`,
    alt: `${brandName}: український бренд, доставка по всій країні. Промо ${promo} активний 30 днів — ${landing}`,
  };
}

async function generateDrafts(args: {
  brandName: string;
  lead_text: string;
  channel: string;
  matched: string[];
  promo: string;
  landing: string;
  hints: ChannelHints;
}): Promise<{ primary: string; alt: string }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return fallbackDrafts(args.brandName, args.promo, args.landing);

  const memoryLines: string[] = [];
  if (args.hints.prefer_length) {
    const target =
      args.hints.prefer_length === "short"
        ? "≤120"
        : args.hints.prefer_length === "medium"
          ? "121-220"
          : "221-280";
    memoryLines.push(`- Цільова довжина: ${target} симв. (з історії канала).`);
  }
  if (args.hints.prefer_tone) {
    memoryLines.push(
      args.hints.prefer_tone === "question"
        ? "- Закінчуй питанням до користувача."
        : "- Тон-ствердження без питання.",
    );
  }
  if (args.hints.positive.length) {
    memoryLines.push("- Що працює:");
    for (const r of args.hints.positive) memoryLines.push(`  • ${r}`);
  }
  if (args.hints.negative.length) {
    memoryLines.push("- Уникай:");
    for (const r of args.hints.negative) memoryLines.push(`  • ${r}`);
  }
  const memBlock = memoryLines.length
    ? "\n\nУРОКИ З ПАМ'ЯТІ АГЕНТА:\n" + memoryLines.join("\n")
    : "";

  const systemPrompt =
    `Ти редактор спільнотного маркетингу для українського бренду ${args.brandName}. ` +
    `Напиши ДВА варіанти короткої корисної відповіді (≤280 симв.) для каналу ${args.channel}. ` +
    `1) Спершу корисна порада по суті. 2) Лише наприкінці нативна згадка бренду + промокод ${args.promo} + ${args.landing}. ` +
    `3) Без капсу, без "купуй зараз". 4) Українською. 5) Не торкайся політики/війни/релігії. ` +
    `Повертай JSON без markdown: {"primary":"...","alt":"..."}.${memBlock}`;

  try {
    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              `КОНТЕКСТ ДОПИСУ (${args.channel}):\n"""${args.lead_text.slice(0, 1500)}"""\n\n` +
              `Тригери: ${args.matched.join(", ") || "—"}.\nЗгенеруй JSON.`,
          },
        ],
        temperature: 0.6,
      }),
    });
    if (!res.ok) return fallbackDrafts(args.brandName, args.promo, args.landing);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j?.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallbackDrafts(args.brandName, args.promo, args.landing);
    const parsed = JSON.parse(m[0]) as { primary?: string; alt?: string };
    if (typeof parsed.primary === "string" && typeof parsed.alt === "string") {
      return { primary: parsed.primary.slice(0, 600), alt: parsed.alt.slice(0, 600) };
    }
    return fallbackDrafts(args.brandName, args.promo, args.landing);
  } catch {
    return fallbackDrafts(args.brandName, args.promo, args.landing);
  }
}

async function runForTenant(tenantId: string, limit: number, onlyLeadId: string | null) {
  const settings = await getSettings(tenantId);
  const { data: tenantRow } = await supabaseAdmin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .single();
  const brandName = tenantRow?.name ?? "MARQ";

  let q = supabaseAdmin
    .from("outreach_leads")
    .select("id, channel, source_url, content, matched_keywords, language, intent_score, status")
    .eq("tenant_id", tenantId)
    .eq("status", "new")
    .gte("intent_score", 0.5)
    .order("intent_score", { ascending: false })
    .order("discovered_at", { ascending: false })
    .limit(limit);
  if (onlyLeadId) q = q.eq("id", onlyLeadId);
  const { data: leads, error } = await q;
  if (error) throw new Error(error.message);

  const stats = { processed: 0, queued: 0, blocked: 0, failed: 0 };
  const hintsCache = new Map<string, ChannelHints>();

  for (const lead of leads ?? []) {
    stats.processed++;
    if (isBlocked(lead.content, settings.blocked_keywords)) {
      await supabaseAdmin
        .from("outreach_leads")
        .update({ status: "rejected" } as never)
        .eq("id", lead.id);
      stats.blocked++;
      continue;
    }
    await supabaseAdmin
      .from("outreach_leads")
      .update({ status: "composing" } as never)
      .eq("id", lead.id);

    const promo = generatePromoCode();
    const landing = buildLandingUrl(settings.default_landing.url, lead.channel, lead.id);
    const utm = buildUtmCampaign(lead.channel, lead.id);
    let hints = hintsCache.get(lead.channel);
    if (!hints) {
      hints = await getChannelHints(tenantId, lead.channel);
      hintsCache.set(lead.channel, hints);
    }
    const drafts = await generateDrafts({
      brandName,
      lead_text: lead.content,
      channel: lead.channel,
      matched: lead.matched_keywords ?? [],
      promo,
      landing,
      hints,
    });

    const action_type =
      lead.channel === "reddit" ||
      lead.channel === "blog" ||
      lead.channel === "google" ||
      lead.channel === "instagram"
        ? "comment"
        : "reply";

    const { error: aErr } = await supabaseAdmin.from("outreach_actions").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      channel: lead.channel,
      action_type,
      draft_text: drafts.primary,
      draft_alt_text: drafts.alt,
      utm_campaign: utm,
      promo_code: promo,
      landing_url: landing,
      status: "pending_review",
    } as never);
    if (aErr) {
      await supabaseAdmin
        .from("outreach_leads")
        .update({ status: "new" } as never)
        .eq("id", lead.id);
      stats.failed++;
      continue;
    }
    await supabaseAdmin
      .from("outreach_leads")
      .update({ status: "queued" } as never)
      .eq("id", lead.id);
    stats.queued++;
  }
  return stats;
}

export const Route = createFileRoute("/hooks/agents/outreach-composer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request
          .clone()
          .json()
          .catch(() => ({}))) as {
          tenant_id?: string;
          lead_id?: string;
          limit?: number;
        };
        const auth = await authorizeOutreach(request, body.tenant_id ?? null);
        if ("error" in auth) return jsonError(auth.error, auth.status);
        const tenants = await resolveTargetTenants(auth, body.tenant_id ?? null);
        const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 25);
        const summary: Record<string, unknown> = {};
        for (const t of tenants) summary[t] = await runForTenant(t, limit, body.lead_id ?? null);
        return jsonOk({ tenants: tenants.length, summary });
      },
    },
  },
});
