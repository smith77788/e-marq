import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  AlertOctagon,
  Boxes,
  CheckCircle2,
  Crown,
  Database,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useT, tStatic } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: tStatic("home.title") },
      { name: "description", content: tStatic("home.metaDesc") },
      { property: "og:title", content: tStatic("home.title") },
      { property: "og:description", content: tStatic("home.metaDesc") },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, user, navigate]);

  const loops = [
    { icon: AlertOctagon, title: t("home.loops.churnTitle"), desc: t("home.loops.churnDesc"), impact: t("home.loops.churnImpact") },
    { icon: Boxes, title: t("home.loops.stockTitle"), desc: t("home.loops.stockDesc"), impact: t("home.loops.stockImpact") },
    { icon: TrendingUp, title: t("home.loops.aovTitle"), desc: t("home.loops.aovDesc"), impact: t("home.loops.aovImpact") },
  ];

  const how = [
    { step: "01", title: t("home.how.s1Title"), desc: t("home.how.s1Desc") },
    { step: "02", title: t("home.how.s2Title"), desc: t("home.how.s2Desc") },
    { step: "03", title: t("home.how.s3Title"), desc: t("home.how.s3Desc") },
    { step: "04", title: t("home.how.s4Title"), desc: t("home.how.s4Desc") },
  ];

  const why = [
    { icon: Crown, title: t("home.why.multiTitle"), desc: t("home.why.multiDesc") },
    { icon: Database, title: t("home.why.memTitle"), desc: t("home.why.memDesc") },
    { icon: Users, title: t("home.why.queueTitle"), desc: t("home.why.queueDesc") },
    { icon: CheckCircle2, title: t("home.why.shopTitle"), desc: t("home.why.shopDesc") },
  ];

  return (
    <main className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="border-b border-border bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            ACOS
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <Link to="/how-it-works" className="hover:text-foreground transition-colors">{t("site.nav.how")}</Link>
            <Link to="/agents" className="hover:text-foreground transition-colors">{t("site.nav.agents")}</Link>
            <Link to="/pricing" className="hover:text-foreground transition-colors">{t("site.nav.pricing")}</Link>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button asChild size="sm" variant="ghost"><Link to="/login">{t("site.nav.signin")}</Link></Button>
            <Button asChild size="sm"><Link to="/signup">{t("site.nav.signup")}</Link></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" />
            {t("home.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            {t("home.heroPre")}{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              {t("home.heroAccent")}
            </span>{" "}
            {t("home.heroPost")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            {t("home.heroSub")}
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">{t("home.heroCtaPrimary")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">{t("home.heroCtaSecondary")}</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            {t("home.heroNote")}
          </p>
        </div>
      </section>

      {/* Agent loops */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {t("home.loops.eyebrow")}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t("home.loops.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            {t("home.loops.subtitle")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {loops.map((loop) => {
            const Icon = loop.icon;
            return (
              <Card key={loop.title} className="border-border bg-card/50">
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="mt-4 text-lg">{loop.title}</CardTitle>
                  <CardDescription>{loop.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary" className="text-xs">
                    {loop.impact}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {t("home.how.eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t("home.how.title")}
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {how.map((item) => (
              <div key={item.step} className="relative">
                <div className="text-3xl font-bold text-primary/30">{item.step}</div>
                <h3 className="mt-2 text-base font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why ACOS */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {t("home.why.eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t("home.why.title")}
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              {t("home.why.body")}
            </p>
          </div>
          <div className="space-y-4">
            {why.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t("home.cta.title")}
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            {t("home.cta.body")}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">{t("home.cta.primary")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/how-it-works">{t("home.cta.secondary")}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>{t("home.footer.tag")}</span>
          </div>
          <nav className="flex flex-wrap items-center gap-4">
            <Link to="/how-it-works" className="hover:text-foreground">{t("site.nav.how")}</Link>
            <Link to="/agents" className="hover:text-foreground">{t("site.nav.agents")}</Link>
            <Link to="/pricing" className="hover:text-foreground">{t("site.nav.pricing")}</Link>
            <Link to="/login" className="hover:text-foreground">{t("site.nav.signin")}</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
