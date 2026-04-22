/**
 * Lead Agent: Web Prospector
 *
 * Скан-агент шукає українські e-commerce бренди в інтернеті без зовнішніх
 * платних сервісів. Використовує безкоштовні DuckDuckGo lite + heuristics:
 *   - запити по нішах ("магазин X site:.ua", "купити Y instagram")
 *   - простий regex-парсинг сторінки результатів (HTML без JS)
 *   - збагачує prospect полями: website, можливий instagram, нішa
 *   - оцінює fit_score за наявністю ознак (price tag, "купити", немає бота)
 *
 * Все працює всередині Worker'а через звичайний fetch — жодних API-ключів.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeLeadAgent } from "@/lib/lead/auth";

const NICHES = [
  { q: "магазин косметика україна", niche: "cosmetics" },
  { q: "магазин крафтова їжа", niche: "food" },
  { q: "магазин дитячий одяг україна", niche: "kids_fashion" },
  { q: "купити свічки україна shop", niche: "home_decor" },
  { q: "магазин кави україна", niche: "coffee" },
  { q: "магазин аксесуари україна shop", niche: "accessories" },
];

type Found = {
  url: string;
  title: string;
  snippet: string;
  niche: string;
};

const UA_TLD = /\.(ua|com\.ua)\b/i;

async function searchDuckDuckGo(query: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + " site:.ua")}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MarqLeadBot/1.0; +https://marq.lovable.app/bots)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const out: Array<{ url: string; title: string; snippet: string }> = [];
  // DDG lite має блоки: <a class="result__a" href="...">title</a> ... <a class="result__snippet">snippet</a>
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 10) {
    const href = decodeURIComponent(m[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0]);
    const title = stripHtml(m[2]).trim();
    const snippet = stripHtml(m[3]).trim();
    if (UA_TLD.test(href) && /^https?:\/\//.test(href)) out.push({ url: href, title, snippet });
  }
  return out;
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}

function detectInstagram(html: string): string | null {
  const m = /instagram\.com\/([A-Za-z0-9._]{2,30})/i.exec(html);
  return m ? m[1].replace(/\/$/, "") : null;
}

function detectEmail(html: string): string | null {
  const m = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(html);
  return m ? m[0] : null;
}

function scoreSignals(html: string, snippet: string) {
  const signals: Record<string, boolean> = {
    has_price: /\d+\s?(грн|₴)/i.test(html),
    has_buy_cta: /(купити|у\s*кошик|add\s*to\s*cart)/i.test(html),
    has_telegram: /t\.me\/|telegram\.me\//i.test(html),
    has_chatbot: /(intercom|crisp|tawk\.to|jivosite|userlike|gorgias|drift)/i.test(html),
    seems_handmade: /(хендмейд|handmade|майстерня)/i.test(snippet + html),
  };
  // fit: чим більше «магазинних» ознак і чим менше готових ботів — тим краще
  let fit = 40;
  if (signals.has_price) fit += 20;
  if (signals.has_buy_cta) fit += 20;
  if (signals.has_telegram) fit += 5;
  if (signals.seems_handmade) fit += 5;
  if (signals.has_chatbot) fit -= 15;
  return { signals, fit: Math.max(0, Math.min(100, fit)) };
}

async function inspectSite(url: string): Promise<{ html: string } | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarqLeadBot/1.0)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 200_000);
    return { html };
  } catch {
    return null;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export const Route = createFileRoute("/hooks/agents/web-prospector")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeLeadAgent(request);
        if ("error" in auth) return jsonError(auth.error, auth.status);

        const found: Found[] = [];
        for (const n of NICHES) {
          const hits = await searchDuckDuckGo(n.q);
          for (const h of hits.slice(0, 6)) {
            found.push({ ...h, niche: n.niche });
          }
        }

        let created = 0;
        for (const f of found) {
          const origin = originOf(f.url);
          // skip duplicates by website_url unique index
          const inspect = await inspectSite(origin);
          const html = inspect?.html ?? "";
          const insta = detectInstagram(html);
          const email = detectEmail(html);
          const { signals, fit } = scoreSignals(html, f.snippet);

          const { error } = await supabaseAdmin.from("lead_prospects").upsert(
            {
              source: "web_prospector",
              source_query: f.niche,
              name: stripHtml(f.title).slice(0, 120) || origin.replace(/^https?:\/\//, ""),
              website_url: origin,
              instagram_handle: insta,
              email,
              niche: f.niche,
              fit_score: fit,
              signals,
              status: "discovered",
            },
            { onConflict: "lower((website_url))", ignoreDuplicates: true } as never,
          );
          if (!error) created += 1;
        }

        return jsonOk({ ok: true, scanned: found.length, created });
      },
    },
  },
});
