/**
 * Shared header + footer for the public marketing site.
 * Used by /, /how-it-works, /agents, /pricing, /about, /contact.
 *
 * Keeps a single source of truth for nav links so adding a new section
 * doesn't require editing 6 files.
 */
import { Link } from "@tanstack/react-router";
import { Menu, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { useT } from "@/lib/i18n";

export function MarketingHeader() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const navItems = [
    { to: "/how-it-works" as const, label: t("site.nav.how") },
    { to: "/agents" as const, label: t("site.nav.agents") },
    { to: "/pricing" as const, label: t("site.nav.pricing") },
    { to: "/about" as const, label: t("site.nav.about") },
    { to: "/handbook" as const, label: t("site.nav.handbook") },
    { to: "/contact" as const, label: t("site.nav.contact") },
  ];
  return (
    <header className="border-b border-border bg-background/70 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          MARQ
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <Link
            to="/how-it-works"
            className="hover:text-foreground transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            {t("site.nav.how")}
          </Link>
          <Link
            to="/agents"
            className="hover:text-foreground transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            {t("site.nav.agents")}
          </Link>
          <Link
            to="/pricing"
            className="hover:text-foreground transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            {t("site.nav.pricing")}
          </Link>
          <Link
            to="/about"
            className="hover:text-foreground transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            {t("site.nav.about")}
          </Link>
          <Link
            to="/handbook"
            className="hover:text-foreground transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            {t("site.nav.handbook")}
          </Link>
          <Link
            to="/contact"
            className="hover:text-foreground transition-colors"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            {t("site.nav.contact")}
          </Link>
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <LanguageSwitcher />
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="hidden xs:inline-flex sm:inline-flex"
          >
            <Link to="/login" search={{ error: undefined }}>{t("site.nav.signin")}</Link>
          </Button>
          <Button asChild size="sm" className="inline-flex">
            <Link to="/signup">{t("site.nav.signup")}</Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="ghost" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> MARQ
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1 text-sm">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2 text-foreground hover:bg-muted transition-colors"
                    activeProps={{ className: "bg-muted font-medium" }}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 grid gap-2">
                <Button asChild variant="outline" onClick={() => setOpen(false)}>
                  <Link to="/login" search={{ error: undefined }}>{t("site.nav.signin")}</Link>
                </Button>
                <Button asChild onClick={() => setOpen(false)}>
                  <Link to="/signup">{t("site.nav.signup")}</Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  const { t } = useT();
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-5">
        <div className="md:col-span-2">
          <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            MARQ
          </Link>
          <p className="mt-3 text-xs text-muted-foreground max-w-xs">{t("home.footer.tag")}</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {t("site.foot.product")}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/how-it-works" className="hover:text-foreground">
                {t("site.nav.how")}
              </Link>
            </li>
            <li>
              <Link to="/agents" className="hover:text-foreground">
                {t("site.nav.agents")}
              </Link>
            </li>
            <li>
              <Link to="/pricing" className="hover:text-foreground">
                {t("site.nav.pricing")}
              </Link>
            </li>
            <li>
              <Link to="/handbook" className="hover:text-foreground">
                {t("site.nav.handbook")}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {t("site.foot.company")}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/about" className="hover:text-foreground">
                {t("site.nav.about")}
              </Link>
            </li>
            <li>
              <Link to="/contact" className="hover:text-foreground">
                {t("site.nav.contact")}
              </Link>
            </li>
            <li>
              <Link to="/login" search={{ error: undefined }} className="hover:text-foreground">
                {t("site.nav.signin")}
              </Link>
            </li>
            <li>
              <Link to="/signup" className="hover:text-foreground">
                {t("site.nav.signup")}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {t("site.foot.legal")}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/terms" className="hover:text-foreground">
                {t("site.legal.terms")}
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="hover:text-foreground">
                {t("site.legal.privacy")}
              </Link>
            </li>
            <li>
              <Link to="/refund" className="hover:text-foreground">
                {t("site.legal.refund")}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} MARQ</span>
          <span>{t("site.foot.builtFor")}</span>
        </div>
      </div>
    </footer>
  );
}
