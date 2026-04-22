import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Brain, CheckCircle2, Database, RefreshCw, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/how-it-works")({
  head: () =>
    buildSeo({
      title: tStatic("how.metaTitle"),
      description: tStatic("how.metaDesc"),
      path: "/how-it-works",
    }),
  component: HowItWorks,
});

function HowItWorks() {
  const { t } = useT();

  const stages = [
    {
      icon: Database,
      title: t("how.s1.title"),
      points: [t("how.s1.p1"), t("how.s1.p2"), t("how.s1.p3")],
    },
    {
      icon: Zap,
      title: t("how.s2.title"),
      points: [t("how.s2.p1"), t("how.s2.p2"), t("how.s2.p3"), t("how.s2.p4")],
    },
    {
      icon: CheckCircle2,
      title: t("how.s3.title"),
      points: [t("how.s3.p1"), t("how.s3.p2"), t("how.s3.p3")],
    },
    {
      icon: Brain,
      title: t("how.s4.title"),
      points: [t("how.s4.p1"), t("how.s4.p2"), t("how.s4.p3")],
    },
  ];

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("how.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t("how.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            {t("how.subtitle")}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">
                {t("how.ctaStart")} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/agents">{t("how.ctaAgents")}</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {stages.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.title} className="border-border bg-card/60">
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="mt-3 text-lg">{s.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {s.points.map((p) => (
                      <li key={p} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="mt-10 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-primary" /> {t("how.compound.title")}
            </CardTitle>
            <CardDescription>{t("how.compound.desc")}</CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("how.bottom.title")}
          </h2>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">{t("how.ctaStart")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/pricing">{t("how.bottom.viewPrices")}</Link>
            </Button>
          </div>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
