import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, Search, ShoppingCart, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/agents")({
  head: () =>
    buildSeo({
      title: tStatic("ag.metaTitle"),
      description: tStatic("ag.metaDesc"),
      path: "/agents",
    }),
  component: Agents,
});

function Agents() {
  const { t } = useT();

  const agents = [
    {
      icon: Users,
      name: t("ag.churnName"),
      summary: t("ag.churnSummary"),
      impact: t("ag.churnImpact"),
      triggers: ["recency_days", "drift_ratio", "lifetime_value_cents"],
      actions: [t("ag.churnAct")],
    },
    {
      icon: Boxes,
      name: t("ag.stockName"),
      summary: t("ag.stockSummary"),
      impact: t("ag.stockImpact"),
      triggers: ["units_sold_14d", "velocity_per_day", "days_of_supply"],
      actions: [t("ag.stockAct")],
    },
    {
      icon: ShoppingCart,
      name: t("ag.aovName"),
      summary: t("ag.aovSummary"),
      impact: t("ag.aovImpact"),
      triggers: ["abandoned_sessions", "abandoned_checkouts", "recoverable_revenue_cents"],
      actions: [t("ag.aovAct")],
    },
    {
      icon: Search,
      name: t("ag.searchName"),
      summary: t("ag.searchSummary"),
      impact: t("ag.searchImpact"),
      triggers: ["searches_zero_results", "miss_rate"],
      actions: [t("ag.searchAct")],
    },
  ];

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("ag.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t("ag.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            {t("ag.subtitle")}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-5 md:grid-cols-2">
          {agents.map((a) => {
            const Icon = a.icon;
            return (
              <Card key={a.name} className="border-border bg-card/60">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{a.name}</CardTitle>
                  </div>
                  <CardDescription className="mt-3">{a.summary}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm font-medium text-primary">→ {a.impact}</p>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("ag.signals")}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.triggers.map((tr) => (
                        <Badge key={tr} variant="outline" className="text-[10px]">
                          {tr}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("ag.action")}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.actions.map((act) => (
                        <Badge key={act} variant="secondary" className="text-[10px]">
                          {act}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <Button asChild size="lg">
            <Link to="/signup">{t("ag.runOnStore")}</Link>
          </Button>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
