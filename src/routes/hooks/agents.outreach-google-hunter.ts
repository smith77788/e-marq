/**
 * Google/Blog Hunter — DuckDuckGo HTML/Lite, безкоштовно, без API.
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

const DEFAULT_QUERIES = [
  "магазин україна порадьте",
  "де купити натуральне україна",
  "відгуки про український бренд",
  "крафтовий магазин україна форум",
  "новий український бренд instagram",
  "хочу спробувати український бренд",
];

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

async function ddgSearch(query: string): Promise<SearchResult[]> {
  const endpoints = ["https://lite.duckduckgo.com/lite/", "https://html.duckduckgo.com/html/"];
  for (const ep of endpoints) {
    try {
      const body = new URLSearchParams({ q: query, kl: "ua-uk" });
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
          Referer: "https://duckduckgo.com/",
        },
        body: body.toString(),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const stripTags = (s: string) =>
        s
          .replace(/<[^>]+>/g, "")
          .replace(/&[a-z]+;/gi, " ")
          .trim();
      const out: SearchResult[] = [];
      const rxFull =
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const rxLite =
        /<a[^>]*class=['"]result-link['"][^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
      const rx = ep.includes("/lite/") ? rxLite : rxFull;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html)) && out.length < 15) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        try {
          const u = new URL(url);
          const real = u.searchParams.get("uddg");
          if (real) url = decodeURIComponent(real);
        } catch {
          /* ignore */
        }
        out.push({ url, title: stripTags(m[2]), snippet: stripTags(m[3]) });
      }
      if (out.length) return out;
    } catch {
      /* next ep */
    }
  }
  return [];
}

function classifyChannel(url: string): "blog" | "google" {
  const blogHints = /(blog|статт|article|post|новин|news)/i;
  return blogHints.test(url) ? "blog" : "google";
}

async function runForTenant(tenantId: string) {
  const settings = await getSettings(tenantId);
  if (!settings.active_channels.google && !settings.active_channels.blog) {
    return { skipped: "channels_inactive" };
  }
  const queries = DEFAULT_QUERIES.sort(() => Math.random() - 0.5).slice(0, 3);
  const stats = { lang_skip: 0, intent_skip: 0, blocked: 0, dup: 0, created: 0, seen: 0 };
  const errors: string[] = [];

  for (const q of queries) {
    try {
      const results = await ddgSearch(q);
      for (const r of results) {
        stats.seen++;
        const text = `${r.title}\n${r.snippet}`;
        if (isBlocked(text, settings.blocked_keywords)) {
          stats.blocked++;
          continue;
        }
        const lang = detectLanguage(text);
        if (lang !== "uk" && lang !== "ru") {
          stats.lang_skip++;
          continue;
        }
        const intent = scoreIntent(text, settings.intent_keywords);
        if (intent.score < 0.15) {
          stats.intent_skip++;
          continue;
        }
        const channel = classifyChannel(r.url);
        const fp = await fingerprint(channel, r.url, r.snippet);
        const { error: insErr } = await supabaseAdmin.from("outreach_leads").insert({
          tenant_id: tenantId,
          channel,
          source_url: r.url,
          title: r.title.slice(0, 280),
          content: r.snippet.slice(0, 4000),
          language: lang,
          geo_country: "UA",
          intent_score: intent.score,
          topic_tags: [`q:${q.slice(0, 60)}`],
          matched_keywords: intent.matched,
          fingerprint: fp,
          status: "new",
          raw_payload: { source: "ddg", query: q } as never,
        } as never);
        if (insErr) {
          if (insErr.code === "23505") stats.dup++;
          else errors.push(`${q}: ${insErr.message}`);
        } else {
          stats.created++;
        }
      }
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
    } catch (e) {
      errors.push(`${q}: ${(e as Error).message}`);
    }
  }
  return { stats, errors };
}

export const Route = createFileRoute("/hooks/agents/outreach-google-hunter")({
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
