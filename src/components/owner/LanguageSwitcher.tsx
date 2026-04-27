/**
 * Перемикач мови інтерфейсу: UA / RU / EN.
 * Зберігає вибір у localStorage (через setLang з @/lib/i18n).
 *
 * RU словник поки порожній — ключі автоматично падають на UA.
 * Це нормально: ми поступово наповнюємо ru-блок у src/lib/i18n.ts.
 */
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT, type Lang, LANG_LABELS, LANG_SHORT } from "@/lib/i18n";

const LANGS: Lang[] = ["ua", "ru", "en"];

export function LanguageSwitcher() {
  const { lang, setLang } = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          aria-label="Мова інтерфейсу"
        >
          <Globe className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium">{LANG_SHORT[lang]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {LANGS.map((l) => (
          <DropdownMenuItem
            key={l}
            onSelect={() => setLang(l)}
            className={lang === l ? "font-semibold text-primary" : ""}
          >
            <span className="mr-2 text-xs text-muted-foreground">{LANG_SHORT[l]}</span>
            {LANG_LABELS[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
