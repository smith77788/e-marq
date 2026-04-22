/**
 * useAiAsk — клієнтський виклик POST /api/ai/ask з JWT поточного користувача.
 * Повертає answer + suggestions[] (deep links). Без зовнішніх SDK.
 */
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AskSuggestion = { label: string; to: string };
export type AskResult = { answer: string; suggestions: AskSuggestion[] };

export function useAiAsk() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  const ask = useCallback(async (tenantId: string, question: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setError("Потрібна авторизація");
        return;
      }
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: tenantId, question }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<AskResult> & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `Помилка ${res.status}`);
        return;
      }
      setResult({
        answer: json.answer ?? "",
        suggestions: json.suggestions ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  return { ask, reset, loading, error, result };
}
