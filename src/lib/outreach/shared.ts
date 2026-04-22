/**
 * Shared utils для Outreach Hunter (port з Basic Food, multi-tenant edition).
 *
 * - language detection (cyrillic / latin)
 * - intent scoring
 * - fingerprint (SHA-256 hex) для дедуплікації
 * - rate-limit перевірка по каналу
 * - читання settings з кешем (per-tenant)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type OutreachChannel = "reddit" | "google" | "blog" | "telegram" | "instagram" | "other";

export interface OutreachSettings {
  rate_limits: Record<string, number>;
  active_channels: Record<string, boolean>;
  blocked_keywords: string[];
  intent_keywords: string[];
  reddit_subreddits: string[];
  telegram_channels: string[];
  telegram_max_channels_per_run: number;
  telegram_max_posts_per_channel: number;
  telegram_min_intent_score: number;
  telegram_internal_lookback_days: number;
  default_landing: { url: string; utm_source: string; utm_medium: string };
  reddit_posting_enabled: boolean;
  telegram_posting_enabled: boolean;
  instagram_posting_enabled: boolean;
}

const DEFAULTS: OutreachSettings = {
  rate_limits: { reddit: 5, google: 8, blog: 8, telegram: 10, instagram: 15 },
  active_channels: { reddit: true, google: false, blog: false, telegram: false, instagram: false },
  blocked_keywords: ["політика", "війна", "релігія", "18+"],
  intent_keywords: ["шукаю", "порадьте", "де купити", "що краще"],
  reddit_subreddits: ["Ukraine", "lviv", "kyiv"],
  telegram_channels: [],
  telegram_max_channels_per_run: 10,
  telegram_max_posts_per_channel: 35,
  telegram_min_intent_score: 0.22,
  telegram_internal_lookback_days: 21,
  default_landing: {
    url: "https://e-marq.lovable.app",
    utm_source: "outreach",
    utm_medium: "organic",
  },
  reddit_posting_enabled: false,
  telegram_posting_enabled: false,
  instagram_posting_enabled: false,
};

const settingsCache = new Map<string, { value: OutreachSettings; at: number }>();
const SETTINGS_TTL_MS = 60_000;

export async function getSettings(tenantId: string): Promise<OutreachSettings> {
  const hit = settingsCache.get(tenantId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;

  const { data } = await supabaseAdmin
    .from("outreach_settings")
    .select("key, value")
    .eq("tenant_id", tenantId);

  const map: Record<string, unknown> = {};
  for (const r of data ?? []) map[r.key] = (r as { value: unknown }).value;

  const merged: OutreachSettings = {
    rate_limits: (map.rate_limits as Record<string, number>) ?? DEFAULTS.rate_limits,
    active_channels: (map.active_channels as Record<string, boolean>) ?? DEFAULTS.active_channels,
    blocked_keywords: (map.blocked_keywords as string[]) ?? DEFAULTS.blocked_keywords,
    intent_keywords: (map.intent_keywords as string[]) ?? DEFAULTS.intent_keywords,
    reddit_subreddits: (map.reddit_subreddits as string[]) ?? DEFAULTS.reddit_subreddits,
    telegram_channels: (map.telegram_channels as string[]) ?? DEFAULTS.telegram_channels,
    telegram_max_channels_per_run:
      (map.telegram_max_channels_per_run as number) ?? DEFAULTS.telegram_max_channels_per_run,
    telegram_max_posts_per_channel:
      (map.telegram_max_posts_per_channel as number) ?? DEFAULTS.telegram_max_posts_per_channel,
    telegram_min_intent_score:
      (map.telegram_min_intent_score as number) ?? DEFAULTS.telegram_min_intent_score,
    telegram_internal_lookback_days:
      (map.telegram_internal_lookback_days as number) ?? DEFAULTS.telegram_internal_lookback_days,
    default_landing:
      (map.default_landing as OutreachSettings["default_landing"]) ?? DEFAULTS.default_landing,
    reddit_posting_enabled: (map.reddit_posting_enabled as boolean) ?? false,
    telegram_posting_enabled: (map.telegram_posting_enabled as boolean) ?? false,
    instagram_posting_enabled: (map.instagram_posting_enabled as boolean) ?? false,
  };

  settingsCache.set(tenantId, { value: merged, at: Date.now() });
  return merged;
}

export function invalidateSettingsCache(tenantId: string): void {
  settingsCache.delete(tenantId);
}

/** Грубий детектор: ≥30% символів — кирилиця + UA-маркери. */
export function detectLanguage(text: string): "uk" | "ru" | "en" | "other" {
  if (!text) return "other";
  const total = text.length;
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (/[\u0400-\u04FF]/.test(ch)) cyr++;
    else if (/[A-Za-z]/.test(ch)) lat++;
  }
  const cyrPct = cyr / Math.max(total, 1);
  const latPct = lat / Math.max(total, 1);
  if (cyrPct < 0.15 && latPct > 0.4) return "en";
  if (cyrPct < 0.15) return "other";
  if (/[іїєґ]/i.test(text)) return "uk";
  if (/[ёыэъ]/i.test(text)) return "ru";
  return "uk";
}

export function scoreIntent(
  text: string,
  intentKeywords: string[],
): {
  score: number;
  matched: string[];
} {
  if (!text) return { score: 0, matched: [] };
  const t = text.toLowerCase();
  const matched: string[] = [];
  for (const kw of intentKeywords) {
    if (kw && t.includes(kw.toLowerCase())) matched.push(kw);
  }
  let score = Math.min(0.7, matched.length * 0.18);
  if (/\?|порадь|порадіть|підкажіть|шукаю|recommend|suggestion/i.test(text)) score += 0.15;
  if (text.length < 30) score *= 0.5;
  return { score: Math.max(0, Math.min(1, +score.toFixed(3))), matched };
}

export function isBlocked(text: string, blockedKeywords: string[]): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return blockedKeywords.some((k) => k && t.includes(k.toLowerCase()));
}

export async function fingerprint(
  channel: string,
  sourceUrl: string,
  snippet: string,
): Promise<string> {
  const data = `${channel}::${sourceUrl}::${snippet.slice(0, 200)}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Перевірка денного ліміту для каналу. */
export async function checkDailyRateLimit(
  tenantId: string,
  channel: OutreachChannel,
  limit: number,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("outreach_actions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .in("status", ["posted", "approved"])
    .gte("created_at", since);
  const used = count ?? 0;
  return { allowed: used < limit, used, limit };
}

export function buildUtmCampaign(channel: string, leadId: string): string {
  const short = leadId.replace(/-/g, "").slice(0, 8);
  return `outreach_${channel}_${short}`;
}

export function buildLandingUrl(base: string, channel: string, leadId: string): string {
  const u = new URL(base);
  u.searchParams.set("utm_source", `${channel}_outreach`);
  u.searchParams.set("utm_medium", "organic");
  u.searchParams.set("utm_campaign", buildUtmCampaign(channel, leadId));
  u.searchParams.set("utm_content", leadId.replace(/-/g, "").slice(0, 8));
  return u.toString();
}

export function generatePromoCode(prefix = "OUT"): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}${c}`;
}
