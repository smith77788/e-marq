/**
 * AI Gateway — підтримка кількох провайдерів з fallback.
 *
 * Провайдери (пріоритет):
 * 1. MiMo Code (Xiaomi) — безкоштовний, основний для агентів
 * 2. Lovable AI Gateway — платний, fallback
 *
 * Використання:
 *   import { aiChat, isAnyAiEnabled } from "@/lib/acos/aiGateway";
 *   const reply = await aiChat({ system, user, temperature: 0.6 });
 */

export type AiProvider = "mimo" | "lovable";

export interface AiChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  provider?: AiProvider;
}

export interface AiChatResult {
  content: string | null;
  provider: AiProvider;
  error?: string;
}

// ─── MiMo Code (Xiaomi) ──────────────────────────────────────
// MiMo Code is free for developers — uses mimo-auto model
// Endpoint: api.xiaomimimo.com (or similar — check current docs)
const MIMO_API_URL = process.env.MIMO_API_URL || "https://api.xiaomimimo.com/v1/chat/completions";
const MIMO_API_KEY = process.env.MIMO_API_KEY || "";
const MIMO_MODEL = process.env.MIMO_MODEL || "mimo-auto";

// ─── Lovable AI Gateway (fallback) ───────────────────────────
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY || "";
const LOVABLE_MODEL = process.env.ACOS_AI_MODEL || "google/gemini-2.5-flash-lite";

/** MiMo enabled if API key is set */
export function isMimoEnabled(): boolean {
  return !!MIMO_API_KEY;
}

/** Lovable AI enabled (legacy killswitch) */
export function isLovableAiEnabled(): boolean {
  if (!LOVABLE_API_KEY) return false;
  const flag = (process.env.ACOS_AI_ENABLED ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") return true;
  const off = (process.env.ACOS_AI_DISABLED ?? "").trim().toLowerCase();
  if (off === "1" || off === "true" || off === "yes" || off === "on") return false;
  return false;
}

/** Any AI provider available */
export function isAnyAiEnabled(): boolean {
  return isMimoEnabled() || isLovableAiEnabled();
}

async function callMimo(opts: AiChatOptions): Promise<AiChatResult> {
  if (!MIMO_API_KEY) return { content: null, provider: "mimo", error: "MIMO_API_KEY not set" };

  try {
    const res = await fetch(MIMO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MIMO_API_KEY}`,
      },
      body: JSON.stringify({
        model: MIMO_MODEL,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { content: null, provider: "mimo", error: `HTTP ${res.status}` };
    }

    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? null;
    return { content, provider: "mimo" };
  } catch (e) {
    return { content: null, provider: "mimo", error: e instanceof Error ? e.message : String(e) };
  }
}

async function callLovable(opts: AiChatOptions): Promise<AiChatResult> {
  if (!LOVABLE_API_KEY) return { content: null, provider: "lovable", error: "LOVABLE_API_KEY not set" };

  try {
    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { content: null, provider: "lovable", error: `HTTP ${res.status}` };
    }

    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? null;
    return { content, provider: "lovable" };
  } catch (e) {
    return { content: null, provider: "lovable", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Main AI chat function with automatic provider fallback.
 * Tries MiMo first (free), falls back to Lovable (paid).
 */
export async function aiChat(opts: AiChatOptions): Promise<AiChatResult> {
  const preferred = opts.provider ?? (isMimoEnabled() ? "mimo" : "lovable");

  if (preferred === "mimo") {
    const result = await callMimo(opts);
    if (result.content) return result;
    // Fallback to Lovable if MiMo fails
    if (isLovableAiEnabled()) {
      const fallback = await callLovable(opts);
      if (fallback.content) return { ...fallback, provider: "lovable" };
    }
    return result;
  }

  const result = await callLovable(opts);
  if (result.content) return result;
  // Fallback to MiMo if Lovable fails
  if (isMimoEnabled()) {
    const fallback = await callMimo(opts);
    if (fallback.content) return { ...fallback, provider: "mimo" };
  }
  return result;
}
