/**
 * AI Gateway killswitch — централізована перевірка чи дозволено робити AI-виклики
 * до Lovable AI Gateway (`ai.gateway.lovable.dev/v1/chat/completions`).
 *
 * Мотивація: AI-виклики платні (списують кредити). Власник проекту може будь-коли
 * глобально вимкнути всі AI-виклики, виставивши env `ACOS_AI_DISABLED=1` (або
 * не виставляючи `LOVABLE_API_KEY`). Усі агенти та фічі мають мати детермінований
 * fallback (template-based copy), щоб система працювала без AI взагалі.
 *
 * За замовчуванням AI **вимкнено** (opt-in), щоб уникнути несподіваних списань.
 * Щоб увімкнути — встановіть `ACOS_AI_ENABLED=1` (або `=true`) разом з
 * `LOVABLE_API_KEY`.
 *
 * Окремо — ключ використовується також для проксі до Resend та Telegram через
 * Lovable Gateway. Це **не** AI-виклики й вони НЕ підпадають під цей kill-switch.
 */

export function isLovableAiEnabled(): boolean {
  if (!process.env.LOVABLE_API_KEY) return false;
  const flag = (process.env.ACOS_AI_ENABLED ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") return true;
  // Backwards-compat: окремий kill-switch ACOS_AI_DISABLED=1 примусово вимикає.
  const off = (process.env.ACOS_AI_DISABLED ?? "").trim().toLowerCase();
  if (off === "1" || off === "true" || off === "yes" || off === "on") return false;
  // Default: AI ВИМКНЕНО. Витрати кредитів — лише при явному opt-in.
  return false;
}

/** Endpoint Lovable AI gateway (LLM completions). */
export const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Дешева модель за замовчуванням (на випадок opt-in). */
export const DEFAULT_AI_MODEL = "google/gemini-2.5-flash-lite";
