/**
 * Reddit Hunter — публічний JSON/RSS, без OAuth.
 * Сканує сабреддіти зі списку outreach_settings.reddit_subreddits, оцінює intent,
 * фільтрує мову та блок-теми, зберігає outreach_leads на кожен tenant.
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
  type OutreachChannel,
} from "@/lib/outreach/shared";

const REDDIT_USER_AGENT = "marq-outreach/1.0 (+https://e-marq.lovable.app)";

interface RedditPost {
  id: string;
  permalink: string;
  url: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  created_utc: number;
  num_comments: number;
  ups: number;
}

async function fetchSubreddit(sub: string, limit = 25): Promise<RedditPost[]> {
  const headersBrowser = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
  };
  const attempts = [
    { url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss?limit=${limit}`, parser: "rss" as const },
    { url: `https://old.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limit}&raw_json=1`, parser: "json" as const },
    { url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limit}&raw_json=1`, parser: "json" as const },
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        headers: { ...headersBrowser, Accept: a.parser === "rss" ? "application/rss+xml,application/xml" : "application/json", "User-Agent": REDDIT_USER_AGENT },
      });
      if (!res.ok) continue;
      if (a.parser === "json") {
        const json = (await res.json().catch(() => null)) as { data?: { children?: Array<{ data?: Record<string, unknown> }> } } | null;
        const children = json?.data?.children ?? [];
        if (!Array.isArray(children) || children.length === 0) continue;
        return children
          .map((c) => c?.data)
          .filter((d): d is Record<string, unknown> => Boolean(d))
          .map((d) => ({
            id: String(d.id ?? ""),
            permalink: `https://www.reddit.com${String(d.permalink ?? "")}`,
            url: String(d.url ?? ""),
            title: String(d.title ?? ""),
            selftext: String(d.selftext ?? ""),
            author: String(d.author ?? "anon"),
            subreddit: String(d.subreddit ?? sub),
            created_utc: Number(d.created_utc ?? 0),
            num_comments: Number(d.num_comments ?? 0),
            ups: Number(d.ups ?? 0),
          }));
      }
      const xml = await res.text();
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
      const out: RedditPost[] = [];
      for (const e of entries) {
        const id = (e.match(/<id>(?:tag:reddit\.com,2008:)?(?:\/r\/[^/]+\/comments\/)?([^<]+)<\/id>/)?.[1] ?? "").split("_").pop() ?? "";
        const link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
        const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
          .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        const author = e.match(/<name>\/u\/([^<]+)<\/name>/)?.[1] ?? "anon";
        const contentRaw = (e.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "")
          .replace(/<!\[CDATA\[|\]\]>/g, "");
        const content = contentRaw
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const updated = e.match(/<updated>([^<]+)<\/updated>/)?.[1];
        const created_utc = updated ? Math.floor(new Date(updated).getTime() / 1000) : Math.floor(Date.now() / 1000);
        if (!id || !link) continue;
        out.push({ id, permalink: link, url: link, title, selftext: content, author, subreddit: sub, created_utc, num_comments: 0, ups: 0 });
      }
      if (out.length) return out;
    } catch { /* try next */ }
  }
  return [];
}

async function runForTenant(tenantId: string): Promise<{
  ok: boolean;
  stats: Record<string, number>;
  errors: string[];
  skipped?: string;
}> {
  const settings = await getSettings(tenantId);
  if (!settings.active_channels.reddit) return { ok: true, stats: {}, errors: [], skipped: "channel_disabled" };
  const subreddits = settings.reddit_subreddits ?? [];
  if (subreddits.length === 0) return { ok: true, stats: {}, errors: [], skipped: "no_subreddits" };

  const stats = { scanned: 0, candidates: 0, inserted: 0, blocked: 0, lowIntent: 0, langSkip: 0, dup: 0 };
  const errors: string[] = [];
  const channel: OutreachChannel = "reddit";

  for (const sub of subreddits) {
    try {
      const posts = await fetchSubreddit(sub, 25);
      stats.scanned += posts.length;
      for (const p of posts) {
        const text = `${p.title}\n\n${p.selftext}`.trim();
        if (!text) continue;
        if (isBlocked(text, settings.blocked_keywords)) { stats.blocked++; continue; }
        const lang = detectLanguage(text);
        const isUaSub = /^(ukrain|lviv|kyiv|kiev|odesa|kharkiv)/i.test(sub);
        if (lang !== "uk" && !(isUaSub && lang === "en")) { stats.langSkip++; continue; }
        const { score, matched } = scoreIntent(text, settings.intent_keywords);
        if (score < 0.25) { stats.lowIntent++; continue; }
        stats.candidates++;
        const fp = await fingerprint("reddit", p.permalink, text);
        const { error: insertErr } = await supabaseAdmin.from("outreach_leads").insert({
          tenant_id: tenantId,
          channel,
          source_url: p.permalink,
          source_platform_id: p.id,
          author_handle: p.author,
          author_url: `https://www.reddit.com/user/${p.author}`,
          title: p.title.slice(0, 280),
          content: text.slice(0, 4000),
          language: lang,
          geo_country: isUaSub ? "UA" : null,
          intent_score: score,
          topic_tags: [`r/${sub}`],
          matched_keywords: matched,
          fingerprint: fp,
          raw_payload: { sub, ups: p.ups, num_comments: p.num_comments, created_utc: p.created_utc } as never,
          discovered_at: new Date(p.created_utc ? p.created_utc * 1000 : Date.now()).toISOString(),
        } as never);
        if (insertErr) {
          if (insertErr.code === "23505") stats.dup++;
          else errors.push(`r/${sub} ${p.id}: ${insertErr.message}`);
        } else {
          stats.inserted++;
        }
      }
    } catch (e) {
      errors.push(`r/${sub}: ${String((e as Error)?.message ?? e)}`);
    }
  }
  return { ok: true, stats, errors };
}

export const Route = createFileRoute("/hooks/agents/outreach-reddit-hunter")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.clone().json().catch(() => ({}))) as { tenant_id?: string };
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
