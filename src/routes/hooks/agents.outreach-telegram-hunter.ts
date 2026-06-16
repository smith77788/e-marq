/**
 * Telegram Public Hunter — публічні t.me/s/<channel> preview сторінки + аналіз
 * вхідних повідомлень із telegram_messages (якщо є).
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
  type OutreachSettings,
} from "@/lib/outreach/shared";

const DEFAULT_CHANNELS = ["dog_ua", "kotyaty", "ua_business", "kyivshop_ua"];

interface TgPost {
  url: string;
  text: string;
  date: string | null;
  channel: string;
}

interface TelegramSignal {
  sourceUrl: string;
  sourcePlatformId: string;
  authorHandle: string;
  title: string;
  content: string;
  language: string;
  geoCountry: string | null;
  intentScore: number;
  matchedKeywords: string[];
  topicTags: string[];
  discoveredAt: string;
  rawPayload: Record<string, unknown>;
}

function boostTelegramIntent(text: string, baseScore: number): number {
  let score = baseScore;
  if (/(порадьте|порекомендуйте|де купити|доставка|ціна|вартість|питаю|підкажіть)/i.test(text))
    score += 0.18;
  if (/(якісн|натурал|крафт|ручної роботи|нов(е|инк|инка))/i.test(text)) score += 0.12;
  if (text.length > 120) score += 0.05;
  return Math.max(0, Math.min(1, +score.toFixed(3)));
}

async function fetchChannel(channel: string, maxPosts: number): Promise<TgPost[]> {
  const url = `https://t.me/s/${channel}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const posts: TgPost[] = [];
  const postIds: { idx: number; id: string }[] = [];
  const postRx = /data-post="([^"]+)"/g;
  let pm: RegExpExecArray | null;
  while ((pm = postRx.exec(html))) postIds.push({ idx: pm.index, id: pm[1] });
  const textRx = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g;
  const dateRx = /<time[^>]*datetime="([^"]+)"/g;
  const dates: { idx: number; ts: string }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRx.exec(html))) dates.push({ idx: dm.index, ts: dm[1] });
  let m: RegExpExecArray | null;
  while ((m = textRx.exec(html)) && posts.length < maxPosts) {
    const idx = m.index;
    const post = [...postIds].reverse().find((p) => p.idx < idx);
    if (!post) continue;
    const date = dates.find((d) => d.idx > idx);
    const text = m[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .trim();
    if (!text || text.length < 20) continue;
    posts.push({ url: `https://t.me/${post.id}`, text, date: date?.ts ?? null, channel });
  }
  return posts;
}

async function collectPublic(
  settings: OutreachSettings,
  channels: string[],
  maxPosts: number,
  minScore: number,
) {
  const signals: TelegramSignal[] = [];
  const errors: string[] = [];
  let seen = 0;
  for (const ch of channels) {
    try {
      const posts = await fetchChannel(ch, maxPosts);
      for (const p of posts) {
        seen++;
        if (isBlocked(p.text, settings.blocked_keywords)) continue;
        const lang = detectLanguage(p.text);
        if (!["uk", "ru", "en"].includes(lang)) continue;
        const baseIntent = scoreIntent(p.text, settings.intent_keywords);
        const finalScore = boostTelegramIntent(p.text, baseIntent.score);
        if (finalScore < minScore) continue;
        signals.push({
          sourceUrl: p.url,
          sourcePlatformId: p.url.split("/").pop() ?? `${p.channel}_${seen}`,
          authorHandle: `@${p.channel}`,
          title: `Публікація в Telegram: @${p.channel}`.slice(0, 280),
          content: p.text.slice(0, 4000),
          language: lang,
          geoCountry: "UA",
          intentScore: finalScore,
          matchedKeywords: baseIntent.matched,
          topicTags: [`tg:${p.channel}`, "telegram_public"],
          discoveredAt: p.date ?? new Date().toISOString(),
          rawPayload: { source: "tg_public", channel: p.channel, posted_at: p.date },
        });
      }
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
    } catch (e) {
      errors.push(`${ch}: ${(e as Error).message}`);
    }
  }
  return { signals, errors, seen };
}

async function collectInternal(
  tenantId: string,
  settings: OutreachSettings,
  lookbackDays: number,
  minScore: number,
) {
  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000).toISOString();
  // У MARQ telegram-сповіщення зберігаються в conversations (channel='telegram', direction='in').
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, body, channel, direction, external_thread_id, customer_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("channel", "telegram")
    .eq("direction", "in")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw new Error(error.message);

  const seenChats = new Set<string>();
  const signals: TelegramSignal[] = [];
  for (const msg of data ?? []) {
    const text = String(msg.body ?? "").trim();
    const chatKey = String(msg.external_thread_id ?? msg.customer_id ?? msg.id);
    if (!text || seenChats.has(chatKey) || isBlocked(text, settings.blocked_keywords)) continue;
    const lang = detectLanguage(text);
    if (!["uk", "ru", "en"].includes(lang)) continue;
    const baseIntent = scoreIntent(text, settings.intent_keywords);
    const finalScore = boostTelegramIntent(text, baseIntent.score);
    if (finalScore < minScore) continue;
    seenChats.add(chatKey);
    signals.push({
      sourceUrl: `${settings.default_landing.url.replace(/\/$/, "")}/brand/inbox?conversation=${msg.id}`,
      sourcePlatformId: `conv_${msg.id}`,
      authorHandle: msg.external_thread_id ? String(msg.external_thread_id) : `Чат ${chatKey}`,
      title: `Живий запит у Telegram-чаті`.slice(0, 280),
      content: text.slice(0, 4000),
      language: lang,
      geoCountry: "UA",
      intentScore: finalScore,
      matchedKeywords: baseIntent.matched,
      topicTags: ["telegram_inbox", "telegram_customer"],
      discoveredAt: msg.created_at,
      rawPayload: {
        source: "tg_inbox",
        conversation_id: msg.id,
        external_thread_id: msg.external_thread_id ?? null,
        customer_id: msg.customer_id ?? null,
        received_at: msg.created_at,
      },
    });
  }
  return { signals, seen: (data ?? []).length };
}

async function runForTenant(tenantId: string) {
  const settings = await getSettings(tenantId);
  if (!settings.active_channels.telegram) return { skipped: "telegram_inactive" };

  const configured = settings.telegram_channels?.length
    ? settings.telegram_channels
    : DEFAULT_CHANNELS;
  const channels = configured.slice(
    0,
    Math.max(1, Number(settings.telegram_max_channels_per_run ?? 10)),
  );
  const minScore = Math.max(0.05, Number(settings.telegram_min_intent_score ?? 0.22));
  const maxPosts = Math.max(5, Number(settings.telegram_max_posts_per_channel ?? 35));
  const lookbackDays = Math.max(1, Number(settings.telegram_internal_lookback_days ?? 21));

  const stats = {
    public_channels_scanned: channels.length,
    public_seen: 0,
    inbox_seen: 0,
    created: 0,
    duplicates: 0,
  };
  const errors: string[] = [];

  const [pub, inbox] = await Promise.all([
    collectPublic(settings, channels, maxPosts, minScore),
    collectInternal(tenantId, settings, lookbackDays, minScore).catch((e) => {
      errors.push(`internal: ${(e as Error).message}`);
      return { signals: [], seen: 0 };
    }),
  ]);

  errors.push(...pub.errors);
  stats.public_seen = pub.seen;
  stats.inbox_seen = inbox.seen;

  const merged = [...inbox.signals, ...pub.signals]
    .sort((a, b) => b.intentScore - a.intentScore)
    .slice(0, 120);

  for (const signal of merged) {
    const fp = await fingerprint("telegram", signal.sourceUrl, signal.content);
    const { data: existing } = await supabaseAdmin
      .from("outreach_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("fingerprint", fp)
      .maybeSingle();
    if (existing) {
      stats.duplicates++;
      continue;
    }
    const { error: insErr } = await supabaseAdmin.from("outreach_leads").insert({
      tenant_id: tenantId,
      channel: "telegram",
      source_url: signal.sourceUrl,
      source_platform_id: signal.sourcePlatformId,
      author_handle: signal.authorHandle,
      title: signal.title,
      content: signal.content,
      language: signal.language,
      geo_country: signal.geoCountry,
      intent_score: signal.intentScore,
      topic_tags: signal.topicTags,
      matched_keywords: signal.matchedKeywords,
      fingerprint: fp,
      status: "new",
      raw_payload: signal.rawPayload as never,
      discovered_at: signal.discoveredAt,
    } as never);
    if (insErr) {
      if (insErr.code === "23505") stats.duplicates++;
      else errors.push(`${signal.sourcePlatformId}: ${insErr.message}`);
    } else {
      stats.created++;
    }
  }
  return { stats, errors };
}

export const Route = createFileRoute("/hooks/agents/outreach-telegram-hunter")({
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
