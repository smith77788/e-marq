/**
 * HandbookSection — одна "глава" з якорем, заголовком, eyebrow та контентом.
 * Стиль: mission-control card із підсвічуванням лівого краю.
 */
import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

type Props = {
  id: string;
  eyebrow?: string;
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function HandbookSection({ id, eyebrow, icon: Icon, title, subtitle, children }: Props) {
  return (
    <section id={id} className="scroll-mt-24 space-y-6">
      <header className="space-y-2 border-l-2 border-primary/60 pl-4">
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary/80">{eyebrow}</p>
        )}
        <h2 className="flex items-center gap-3 text-2xl font-bold tracking-tight md:text-3xl">
          {Icon && <Icon className="h-6 w-6 text-primary" />}
          {title}
        </h2>
        {subtitle && <p className="max-w-2xl text-sm text-muted-foreground md:text-base">{subtitle}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
