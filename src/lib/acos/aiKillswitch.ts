/**
 * AI Gateway killswitch — backward-compatible re-export.
 *
 * All new code should import from "@/lib/acos/aiGateway" directly.
 * This file re-exports for legacy callers.
 */
export {
  isLovableAiEnabled,
  isAnyAiEnabled,
  aiChat,
} from "./aiGateway";

export const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const DEFAULT_AI_MODEL = "google/gemini-2.5-flash-lite";
