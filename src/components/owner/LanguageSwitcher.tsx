import { useT, type Lang } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { lang, setLang } = useT();
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-background text-xs">
      {(["ua", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`px-2 py-1 transition-colors ${
            lang === l
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          } ${l === "ua" ? "rounded-l-md" : "rounded-r-md"}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
