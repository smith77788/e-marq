/**
 * AskPinsBoard — рендериться на дашборді бренду. Показує закріплені AI-запити
 * як live-tile-и: автоматично перепитує `/api/ai/ask` кожні 5 хв і відображає
 * актуальну відповідь. Все детерміновано на бекенді — без AI-кредитів.
 *
 * UX:
 *   - заголовок з 📌 та лічильником
 *   - grid 1/2/3 колонки залежно від breakpoint
 *   - кожен тайл: question + answer + час останнього оновлення + ❌ remove
 *   - якщо немає pins — показуємо empty hint з підказкою як закріпити
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pin, RefreshCw, X, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import { useTenantContext } from "@/hooks/useTenantContext";
import {
  getAskPins,
  removeAskPin,
  subscribeAskPins,
  updateAskPinAnswer,
  type AskPin,
} from "@/lib/aiAskPins";
import { supabase } from "@/integrations/supabase/client";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 хв

type PinState = AskPin & {
  loading: boolean;
  refreshedAt: number | null;
  error?: string | null;
};

async function fetchAnswer(tenantId: string, question: string): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("auth");
  const res = await fetch("/api/ai/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tenant_id: tenantId, question }),
  });
  const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.answer ?? "";
}

function formatRelative(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}с тому`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  return `${h} год тому`;
}

export function AskPinsBoard() {
  const { t } = useT();
  const { currentTenantId } = useTenantContext();
  const [pins, setPins] = useState<PinState[]>([]);

  // Реакція на зміни в localStorage (інші вкладки/панель).
  const reload = useCallback(() => {
    if (!currentTenantId) {
      setPins([]);
      return;
    }
    const fresh = getAskPins(currentTenantId);
    setPins((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return fresh.map((f) => {
        const existing = byId.get(f.id);
        return existing
          ? { ...existing, question: f.question, lastAnswer: f.lastAnswer ?? existing.lastAnswer }
          : { ...f, loading: false, refreshedAt: null, error: null };
      });
    });
  }, [currentTenantId]);

  useEffect(() => {
    reload();
    const unsub = subscribeAskPins(() => reload());
    return unsub;
  }, [reload]);

  const refreshOne = useCallback(
    async (pin: PinState) => {
      if (!currentTenantId) return;
      setPins((prev) =>
        prev.map((p) => (p.id === pin.id ? { ...p, loading: true, error: null } : p)),
      );
      try {
        const answer = await fetchAnswer(currentTenantId, pin.question);
        updateAskPinAnswer(currentTenantId, pin.id, answer);
        setPins((prev) =>
          prev.map((p) =>
            p.id === pin.id
              ? { ...p, lastAnswer: answer, loading: false, refreshedAt: Date.now(), error: null }
              : p,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        setPins((prev) =>
          prev.map((p) =>
            p.id === pin.id ? { ...p, loading: false, error: msg } : p,
          ),
        );
      }
    },
    [currentTenantId],
  );

  // Auto-refresh кожні 5 хв (та одразу при першому маунті для тих, де ще немає answer).
  useEffect(() => {
    if (!currentTenantId || pins.length === 0) return;
    // Initial fill для pins без refreshedAt:
    pins.forEach((p) => {
      if (!p.refreshedAt && !p.loading) void refreshOne(p);
    });
    const id = setInterval(() => {
      pins.forEach((p) => void refreshOne(p));
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenantId, pins.length]);

  const hasPins = pins.length > 0;
  const pinCount = useMemo(() => pins.length, [pins]);

  if (!currentTenantId) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pin className="h-4 w-4 text-primary" />
          {t("pins.title")}
          {hasPins && (
            <Badge variant="secondary" className="text-[10px]">
              {pinCount}
            </Badge>
          )}
        </CardTitle>
        {hasPins && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => pins.forEach((p) => void refreshOne(p))}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            {t("pins.refreshAll")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!hasPins ? (
          <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-center">
            <Sparkles className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{t("pins.empty")}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/80">{t("pins.emptyHint")}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pins.map((pin) => (
              <div
                key={pin.id}
                className="group relative flex flex-col gap-2 rounded-md border bg-card/50 p-3 transition-colors hover:bg-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-medium text-foreground">
                    {pin.question}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeAskPin(currentTenantId, pin.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    aria-label={t("pins.remove")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {pin.loading && !pin.lastAnswer ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {t("pins.loading")}
                  </div>
                ) : pin.error ? (
                  <p className="text-[11px] text-destructive">{pin.error}</p>
                ) : (
                  <p className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                    {pin.lastAnswer || t("pins.loading")}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {pin.loading ? t("pins.refreshing") : formatRelative(pin.refreshedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshOne(pin)}
                    disabled={pin.loading}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    aria-label={t("pins.refresh")}
                  >
                    <RefreshCw className={`h-3 w-3 ${pin.loading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
