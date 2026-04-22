import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass, Heart, Sparkles, Target, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () =>
    buildSeo({
      title: tStatic("ab.metaTitle"),
      description: tStatic("ab.metaDesc"),
      path: "/about",
    }),
  component: AboutPage,
});

function AboutPage() {
  const { t } = useT();

  const values = [
    { icon: Target, title: t("ab.v1Title"), desc: t("ab.v1Desc") },
    { icon: Heart, title: t("ab.v2Title"), desc: t("ab.v2Desc") },
    { icon: Zap, title: t("ab.v3Title"), desc: t("ab.v3Desc") },
    { icon: Compass, title: t("ab.v4Title"), desc: t("ab.v4Desc") },
  ];

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("ab.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t("ab.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            {t("ab.subtitle")}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16">
        <div className="prose prose-invert max-w-none space-y-6 text-base leading-relaxed text-muted-foreground">
          <p>{t("ab.story1")}</p>
          <p>{t("ab.story2")}</p>
          <p>{t("ab.story3")}</p>
        </div>
      </section>

      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("ab.valuesEyebrow")}</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("ab.valuesTitle")}</h2>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {values.map((v) => {
              const Icon = v.icon;
              return (
                <Card key={v.title} className="border-border bg-card/60">
                  <CardHeader>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="mt-3 text-lg">{v.title}</CardTitle>
                    <CardDescription>{v.desc}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("ab.ctaTitle")}</h2>
        <p className="mt-4 text-base text-muted-foreground">{t("ab.ctaBody")}</p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button asChild size="lg">
            <Link to="/signup">{t("ab.ctaPrimary")} <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/contact">{t("ab.ctaSecondary")}</Link>
          </Button>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
