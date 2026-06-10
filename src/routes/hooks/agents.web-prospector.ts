/**
 * Lead Agent: Web Prospector (brand-aware edition)
 *
 * Скан-агент шукає потенційні бренди в інтернеті ПІД ТЕМАТИКУ КОЖНОГО
 * АКТИВНОГО ТЕНАНТА. Замість одного hardcoded списку «українських ніш»
 * тепер для кожного тенанта читається `brand_profile` (з авто-синтезом
 * з products/seo, якщо профілю ще немає) і генеруються власні запити.
 *
 *   - DuckDuckGo lite (HTML без JS) — без API-ключів
 *   - regex-парсинг сторінки результатів
 *   - збагачення prospect: website / instagram / email / нішa / signals
 *   - fit_score за наявністю «магазинних» ознак
 *
 * Все працює всередині Worker'а через звичайний fetch.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeLeadAgent } from "@/lib/lead/auth";
import { getAllTenantBrandContexts, type TenantBrandContext } from "@/lib/lead/brandContext";

type Found = {
  url: string;
  title: string;
  snippet: string;
  niche: string;
  source_query: string;
  source_tenant_id: string;
  source_tenant_brand: string;
};

const UA_TLD = /\.(ua|com\.ua)\b/i;
const MAX_QUERIES_PER_TENANT = 4;
const MAX_HITS_PER_QUERY = 6;

async function searchDuckDuckGo(
  query: string,
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + " site:.ua")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarqLeadBot/1.0; +https://e-marq.lovable.app/bots)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const html = await res.text();
  const out: Array<{ url: string; title: string; snippet: string }> = [];
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 10) {
    const href = decodeURIComponent(
      m[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0],
    );
    const title = stripHtml(m[2]).trim();
    const snippet = stripHtml(m[3]).trim();
    if (UA_TLD.test(href) && /^https?:\/\//.test(href)) out.push({ url: href, title, snippet });
  }
  return out;
}

function stripHtml(s: string) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
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
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MarqLeadBot/1.0)" },
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

        const tenants: TenantBrandContext[] = await getAllTenantBrandContexts();
        if (tenants.length === 0) {
          return jsonOk({
            ok: true,
            scanned: 0,
            created: 0,
            tenants: 0,
            note: "Немає активних брендів — додайте бізнес, щоб агент почав шукати кандидатів під його тематику.",
          });
        }

        // 1) Збираємо результати з пошуку для всіх брендів
        const found: Found[] = [];
        const perTenant: Record<string, { queries: number; hits: number }> = {};

        for (const t of tenants) {
          const queries = t.search_queries.slice(0, MAX_QUERIES_PER_TENANT);
          perTenant[t.tenant_id] = { queries: queries.length, hits: 0 };
          for (const q of queries) {
            const hits = await searchDuckDuckGo(q.q);
            for (const h of hits.slice(0, MAX_HITS_PER_QUERY)) {
              found.push({
                ...h,
                niche: q.niche,
                source_query: q.q,
                source_tenant_id: t.tenant_id,
                source_tenant_brand: t.profile.brand_name,
              });
              perTenant[t.tenant_id].hits++;
            }
          }
        }

        // 2) Збагачуємо й пишемо у lead_prospects (дедуп по website_url)
        let created = 0;
        for (const f of found) {
          const origin = originOf(f.url);
          const inspect = await inspectSite(origin);
          const html = inspect?.html ?? "";
          const insta = detectInstagram(html);
          const email = detectEmail(html);
          const { signals, fit } = scoreSignals(html, f.snippet);

          const { data: upserted, error } = await supabaseAdmin
            .from("lead_prospects")
            .upsert(
              {
                source: "web_prospector",
                source_query: f.source_query,
                name: stripHtml(f.title).slice(0, 120) || origin.replace(/^https?:\/\//, ""),
                website_url: origin,
                instagram_handle: insta,
                email,
                niche: f.niche,
                fit_score: fit,
                signals: {
                  ...signals,
                  discovered_for_tenant: f.source_tenant_id,
                  discovered_for_brand: f.source_tenant_brand,
                },
                status: "discovered",
              },
              { onConflict: "lower((website_url))", ignoreDuplicates: true } as never,
            )
            .select("id");
          if (error) {
            console.error("[web-prospector] upsert failed:", error.message);
          } else if ((upserted?.length ?? 0) > 0) {
            created += 1;
          }
        }

        return jsonOk({
          ok: true,
          tenants: tenants.length,
          scanned: found.length,
          created,
          per_tenant: perTenant,
        });
      },
    },
  },
});
