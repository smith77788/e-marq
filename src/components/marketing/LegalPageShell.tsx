/**
 * Спільний layout для юридичних сторінок (/terms, /privacy, /refund).
 * Дає узгоджену типографію, заголовок, дату оновлення та помітку, що
 * це шаблон, який кожен бренд має адаптувати під своє законодавство.
 */
import type { ReactNode } from "react";
import { MarketingHeader, MarketingFooter } from "./MarketingShell";
import { useT } from "@/lib/i18n";

type Props = {
  title: string;
  intro: string;
  updated: string;
  children: ReactNode;
};

export function LegalPageShell({ title, intro, updated, children }: Props) {
  const { t } = useT();
  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />
      <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <header className="mb-8 border-b border-border pb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t("site.legal.kicker")}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">{intro}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("site.legal.updated")}: {updated}
          </p>
        </header>
        <div className="prose prose-sm max-w-none text-foreground/85 [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">
          {children}
        </div>
      </article>
      <MarketingFooter />
    </main>
  );
}
