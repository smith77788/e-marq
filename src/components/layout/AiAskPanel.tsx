/**
 * AiAskPanel — рендериться всередині CommandList коли користувач починає
 * запит з `?` або `>`. Викликає /api/ai/ask, показує stream-like loader,
 * відповідь, suggestions як натиснені CommandItem-и, а також історію
 * запитів (per-tenant, localStorage), стартові підказки, та три унікальні
 * швидкі дії: 📌 закріпити на дашборді, ⤓ експорт, копіювання.
 */
import { useEffect, useRef, useState } from "react";
import { CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command";
import {
  ArrowRight,
  Clock,
  Copy,
  Download,
  History,
  Link2,
  Loader2,
  Pin,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { useAiAsk } from "@/lib/useAiAsk";
import {
  STARTER_PROMPTS,
  clearAskHistory,
  getAskHistory,
  pushAskHistory,
} from "@/lib/aiAskHistory";
import { addAskPin, isPinned } from "@/lib/aiAskPins";

type Props = {
  tenantId: string | null;
  question: string;
  /** Викликається коли користувач натискає suggestion (deep link). */
  onNavigate: (to: string) => void;
  /**
   * Викликається коли користувач натискає історію або стартову підказку —
   * GlobalSearch має підставити рядок у CommandInput (зі збереженням префіксу `?`).
   */
  onPickQuestion?: (question: string) => void;
};

function downloadAsTxt(question: string, answer: string): void {
  if (typeof window === "undefined") return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const body = `# AI Ask Export\n\nDate: ${new Date().toLocaleString()}\n\nQuestion:\n${question}\n\nAnswer:\n${answer}\n`;
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-ask-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AiAskPanel({ tenantId, question, onNavigate, onPickQuestion }: Props) {
  const { t } = useT();
  const { ask, loading, error, result, reset } = useAiAsk();
  const lastKey = useRef<string>("");
  const lastSavedKey = useRef<string>("");
  const [pinnedFlash, setPinnedFlash] = useState(false);

  useEffect(() => {
    const trimmed = question.trim();
    if (!tenantId || trimmed.length < 3) {
      reset();
      lastKey.current = "";
      return;
    }
    const key = `${tenantId}::${trimmed}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const id = setTimeout(() => {
      void ask(tenantId, trimmed);
    }, 450);
    return () => clearTimeout(id);
  }, [tenantId, question, ask, reset]);

  // Зберігаємо у історію тільки після успішної відповіді (без error / loading).
  useEffect(() => {
    if (!tenantId || loading || error || !result) return;
    const trimmed = question.trim();
    if (trimmed.length < 3) return;
    const saveKey = `${tenantId}::${trimmed}`;
    if (saveKey === lastSavedKey.current) return;
    lastSavedKey.current = saveKey;
    pushAskHistory(tenantId, trimmed);
  }, [tenantId, question, loading, error, result]);

  if (!tenantId) {
    return (
      <CommandGroup heading={t("gs.aiHeading")}>
        <CommandItem disabled value="ai-no-tenant">
          <Sparkles className="mr-2 h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("gs.aiNoTenant")}</span>
        </CommandItem>
      </CommandGroup>
    );
  }

  const trimmed = question.trim();
  const showStarters = trimmed.length < 3 && !loading && !result;
  const history = showStarters ? getAskHistory(tenantId) : [];
  const alreadyPinned = result ? isPinned(tenantId, trimmed) : false;

  return (
    <>
      <CommandGroup heading={t("gs.aiHeading")}>
        {loading && (
          <CommandItem disabled value="ai-loading">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">{t("gs.aiThinking")}</span>
          </CommandItem>
        )}
        {!loading && error && (
          <CommandItem disabled value="ai-error">
            <Sparkles className="mr-2 h-4 w-4 text-destructive" />
            <span className="text-xs text-destructive">{error}</span>
          </CommandItem>
        )}
        {!loading && !error && result && (
          <>
            <CommandItem
              value={`ai-answer::${result.answer.slice(0, 40)}`}
              onSelect={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(result.answer).then(
                    () => toast.success(t("gs.aiCopied")),
                    () => toast.error("Не вдалося скопіювати"),
                  );
                }
              }}
              className="items-start"
            >
              <Sparkles className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                {result.answer}
              </span>
            </CommandItem>
            <CommandItem
              value={`ai-action-pin::${trimmed}`}
              disabled={alreadyPinned || pinnedFlash}
              onSelect={() => {
                const pin = addAskPin(tenantId, trimmed, result.answer);
                if (pin) {
                  setPinnedFlash(true);
                  toast.success(t("gs.aiPinned"));
                }
              }}
            >
              <Pin className="mr-2 h-4 w-4 text-primary" />
              <span className="text-xs">
                {alreadyPinned || pinnedFlash ? t("gs.aiPinned") : t("gs.aiPin")}
              </span>
            </CommandItem>
            <CommandItem
              value={`ai-action-export::${trimmed}`}
              onSelect={() => {
                downloadAsTxt(trimmed, result.answer);
                toast.success(t("gs.aiExported"));
              }}
            >
              <Download className="mr-2 h-4 w-4 text-info" />
              <span className="text-xs">{t("gs.aiExport")}</span>
            </CommandItem>
            <CommandItem
              value={`ai-action-share::${trimmed}`}
              onSelect={() => {
                if (typeof window === "undefined") return;
                const url = new URL(window.location.href);
                url.searchParams.set("ask", trimmed);
                const link = url.toString();
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(link).then(
                    () => toast.success(t("gs.aiShareCopied")),
                    () => toast.error("Не вдалося скопіювати"),
                  );
                }
              }}
            >
              <Link2 className="mr-2 h-4 w-4 text-info" />
              <span className="text-xs">{t("gs.aiShare")}</span>
            </CommandItem>
            <CommandItem
              value={`ai-action-copy::${trimmed}`}
              onSelect={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(result.answer).then(
                    () => toast.success(t("gs.aiCopied")),
                    () => toast.error("Не вдалося скопіювати"),
                  );
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="text-xs">{t("gs.aiCopy")}</span>
            </CommandItem>
          </>
        )}
        {showStarters && (
          <CommandItem disabled value="ai-hint">
            <Sparkles className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("gs.aiHint")}</span>
          </CommandItem>
        )}
      </CommandGroup>

      {showStarters && history.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t("gs.aiHistory")}>
            {history.map((q) => (
              <CommandItem
                key={`ai-hist::${q}`}
                value={`ai-hist::${q}`}
                onSelect={() => onPickQuestion?.(q)}
              >
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate text-xs">{q}</span>
              </CommandItem>
            ))}
            <CommandItem
              value="ai-hist-clear"
              onSelect={() => {
                clearAskHistory(tenantId);
                onPickQuestion?.("");
              }}
            >
              <Trash2 className="mr-2 h-4 w-4 text-destructive" />
              <span className="text-xs text-destructive">{t("gs.aiClearHistory")}</span>
            </CommandItem>
          </CommandGroup>
        </>
      )}

      {showStarters && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t("gs.aiStarters")}>
            {STARTER_PROMPTS.map((q) => (
              <CommandItem
                key={`ai-start::${q}`}
                value={`ai-start::${q}`}
                onSelect={() => onPickQuestion?.(q)}
              >
                <History className="mr-2 h-4 w-4 text-info" />
                <span className="flex-1 truncate text-xs">{q}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}

      {result && result.suggestions.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t("gs.aiSuggestions")}>
            {result.suggestions.map((s) => (
              <CommandItem
                key={`ai-sug::${s.to}::${s.label}`}
                value={`ai-sug::${s.label}::${s.to}`}
                onSelect={() => onNavigate(s.to)}
              >
                <ArrowRight className="mr-2 h-4 w-4 text-info" />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="ml-2 truncate text-[10px] text-muted-foreground">{s.to}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
    </>
  );
}
