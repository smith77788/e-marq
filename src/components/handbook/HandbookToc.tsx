/**
 * HandbookToc — sticky-навігація по розділах посібника.
 * На мобільних рендериться як горизонтальна прокрутка.
 */
import { useT, type TKey } from "@/lib/i18n";

const SECTIONS: { id: string; labelKey: TKey }[] = [
  { id: "what", labelKey: "hb.toc.what" },
  { id: "who", labelKey: "hb.toc.who" },
  { id: "owner", labelKey: "hb.toc.owner" },
  { id: "admin", labelKey: "hb.toc.admin" },
  { id: "agents", labelKey: "hb.toc.agents" },
  { id: "integrations", labelKey: "hb.toc.integrations" },
  { id: "pricing", labelKey: "hb.toc.pricing" },
  { id: "quickstart", labelKey: "hb.toc.quickstart" },
  { id: "faq", labelKey: "hb.toc.faq" },
];

export function HandbookToc() {
  const { t } = useT();
  return (
    <nav
      aria-label="Зміст посібника"
      className="sticky top-4 hidden w-56 shrink-0 lg:block"
    >
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
        {t("hb.toc.title")}
      </p>
      <ul className="space-y-1 text-sm">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              {t(s.labelKey)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function HandbookTocMobile() {
  const { t } = useT();
  return (
    <nav
      aria-label="Зміст посібника"
      className="lg:hidden -mx-4 overflow-x-auto px-4 pb-2"
    >
      <ul className="flex min-w-max gap-2 text-sm">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="inline-block rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              {t(s.labelKey)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
