/**
 * Instagram Hashtag Harvester — RSS-міст (опційно через INSTAGRAM_RSS_URL).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeOutreach, resolveTargetTenants } from "@/lib/outreach/auth";
import {
  getSettings,
  detectLanguage,
  scoreIntent,
  isBlocked,
  fingerprint,
} from "@/lib/outreach/shared";

const DEFAULT_HASHTAGS = ["українськийбренд", "крафтukraine", "shopua", "купитиукраїна"];
const RSS_BASE = process.env.INSTAGRAM_RSS_URL ?? "";

interface IgPost {
  url: string;
  caption: string;
  hashtag: string;
  posted_at?: string;
}

function parseRss(xml: string, hashtag: string): IgPost[] {
  const out: IgPost[] = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(xml)) && out.length < 15) {
    const block = m[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const title = (
      block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? ""
    ).trim();
    const desc = (
      block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? ""
    )
      .replace(/<[^>]+>/g, " ")
      .trim();
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "").trim();
    const caption = [title, desc].filter(Boolean).join(" — ").slice(0, 1500);
    if (!link || !caption) continue;
    out.push({ url: link, caption, hashtag, posted_at: pub || undefined });
  }
  return out;
}

async function fetchHashtag(tag: string): Promise<IgPost[]> {
  if (!RSS_BASE) return [];
  const url = `${RSS_BASE.replace(/\/+$/, "")}/instagram/tag/${encodeURIComponent(tag)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MarqOutreach/1.0", Accept: "application/rss+xml,*/*" },
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), tag);
  } catch {
    return [];
  }
}

async function runForTenant(tenantId: string) {
  const settings = await getSettings(tenantId);
  if (!settings.active_channels.instagram) return { skipped: "instagram_inactive" };
  if (!RSS_BASE) return { skipped: "no_rss_bridge", hint: "Set INSTAGRAM_RSS_URL secret" };

  const { data: tagRow } = await supabaseAdmin
    .from("outreach_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "instagram_hashtags")
    .maybeSingle();
  const tags = Array.isArray(tagRow?.value) ? (tagRow!.value as string[]) : DEFAULT_HASHTAGS;
  const sample = tags.sort(() => Math.random() - 0.5).slice(0, 3);

  const stats = { created: 0, seen: 0 };
  const errors: string[] = [];
  for (const tag of sample) {
    try {
      const posts = await fetchHashtag(tag);
      for (const p of posts) {
        stats.seen++;
        if (isBlocked(p.caption, settings.blocked_keywords)) continue;
        const lang = detectLanguage(p.caption);
        if (!["uk", "ru", "en"].includes(lang)) continue;
        const intent = scoreIntent(p.caption, settings.intent_keywords);
        if (intent.score < 0.2) continue;
        const fp = await fingerprint("instagram", p.url, p.caption);
        const { data: existing } = await supabaseAdmin
          .from("outreach_leads")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("fingerprint", fp)
          .maybeSingle();
        if (existing) continue;
        const { error: insErr } = await supabaseAdmin.from("outreach_leads").insert({
          tenant_id: tenantId,
          channel: "instagram",
          source_url: p.url,
          title: `IG #${p.hashtag}`.slice(0, 280),
          content: p.caption.slice(0, 4000),
          language: lang,
          intent_score: intent.score,
          topic_tags: [`ig:#${p.hashtag}`],
          matched_keywords: intent.matched,
          fingerprint: fp,
          status: "new",
          raw_payload: { source: "ig_rss", hashtag: tag, posted_at: p.posted_at } as never,
          discovered_at: p.posted_at ?? new Date().toISOString(),
        } as never);
        if (insErr) {
          if (insErr.code !== "23505") errors.push(`${tag}: ${insErr.message}`);
        } else {
          stats.created++;
        }
      }
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 800));
    } catch (e) {
      errors.push(`${tag}: ${(e as Error).message}`);
    }
  }
  return { stats, errors, tags_scanned: sample.length };
}

export const Route = createFileRoute("/hooks/agents/outreach-instagram-hunter")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request
          .clone()
          .json()
          .catch(() => ({}))) as { tenant_id?: string };
        const auth = await authorizeOutreach(request, body.tenant_id ?? null);
        if ("error" in auth) return jsonError(auth.error, auth.status);
        const tenants = await resolveTargetTenants(auth, body.tenant_id ?? null);
        const summary: Record<string, unknown> = {};
        for (const t of tenants) summary[t] = await runForTenant(t);
        return jsonOk({ tenants: tenants.length, summary });
      },
    },
  },
});
