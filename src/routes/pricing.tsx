import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/pricing")({
  head: () =>
    buildSeo({
      title: tStatic("pr.metaTitle"),
      description: tStatic("pr.metaDesc"),
      path: "/pricing",
    }),
  component: Pricing,
});

function Pricing() {
  const { t } = useT();
  const plans = [
    {
      name: t("pr.pilotName"),
      price: t("pr.pilotPrice"),
      cadence: t("pr.pilotCadence"),
      desc: t("pr.pilotDesc"),
      features: [t("pr.pilotF1"), t("pr.pilotF2"), t("pr.pilotF3"), t("pr.pilotF4")],
      cta: t("pr.pilotCta"),
      highlight: false,
    },
    {
      name: t("pr.growthName"),
      price: t("pr.growthPrice"),
      cadence: t("pr.growthCadence"),
      desc: t("pr.growthDesc"),
      features: [
        t("pr.growthF1"),
        t("pr.growthF2"),
        t("pr.growthF3"),
        t("pr.growthF4"),
        t("pr.growthF5"),
      ],
      cta: t("pr.growthCta"),
      highlight: true,
    },
    {
      name: t("pr.portName"),
      price: t("pr.portPrice"),
      cadence: t("pr.portCadence"),
      desc: t("pr.portDesc"),
      features: [t("pr.portF1"), t("pr.portF2"), t("pr.portF3"), t("pr.portF4")],
      cta: t("pr.portCta"),
      highlight: false,
    },
  ];

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("pr.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t("pr.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            {t("pr.subtitle")}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <Card
              key={p.name}
              className={
                p.highlight ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-card/60"
              }
            >
              <CardHeader>
                {p.highlight && (
                  <Badge className="mb-2 w-fit" variant="default">
                    {t("pr.popular")}
                  </Badge>
                )}
                <CardTitle className="text-xl">{p.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-foreground">{p.price}</span>
                  <span className="text-xs text-muted-foreground">{p.cadence}</span>
                </div>
                <CardDescription className="mt-2">{p.desc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full" variant={p.highlight ? "default" : "outline"}>
                  <Link to="/signup">{p.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">{t("pr.note")}</p>
      </section>
      <MarketingFooter />
    </main>
  );
}
