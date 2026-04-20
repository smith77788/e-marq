import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, Search, ShoppingCart, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "ACOS Agents — Churn, Stockout, AOV, Search Gap" },
      {
        name: "description",
        content:
          "Meet the always-on ACOS agents: Churn Risk Predictor, Stockout Predictor, AOV Leak Detector and Search Gap Detector. Each ships explainable insights with expected revenue impact.",
      },
      { property: "og:title", content: "ACOS Agents — autonomous revenue analysts" },
      {
        property: "og:description",
        content: "Four specialized agents continuously hunt for revenue in your D2C data. Explainable, approvable, learnable.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agents,
});

const AGENTS = [
  {
    icon: Users,
    name: "Churn Risk Predictor",
    summary:
      "Calculates recency drift = days_since_last_order / avg_interval for VIPs (≥4 paid orders). Flags those with drift > 1.5× and 14d+ silent.",
    impact: "Recover 8–15% of latent VIP revenue with timely winback touches.",
    triggers: ["recency_days", "drift_ratio", "lifetime_value_cents"],
    actions: ["winback_touch (15% off, email channel)"],
  },
  {
    icon: Boxes,
    name: "Stockout Predictor",
    summary:
      "Computes 14-day sales velocity per SKU and projects days_of_supply. Surfaces SKUs with <7d cover and velocity > 0.3 u/day.",
    impact: "Prevents lost sales from out-of-stock — typical save 3–7% gross revenue.",
    triggers: ["units_sold_14d", "velocity_per_day", "days_of_supply"],
    actions: ["reorder_request (30-day cover)"],
  },
  {
    icon: ShoppingCart,
    name: "AOV Leak Detector",
    summary:
      "Walks the funnel events for the last 14 days. Finds products where add_to_cart never converts to purchase, groups by SKU.",
    impact: "Recover ~25% of abandoned carts via timely reminder + 10% nudge.",
    triggers: ["abandoned_sessions", "abandoned_checkouts", "recoverable_revenue_cents"],
    actions: ["abandoned_cart_email"],
  },
  {
    icon: Search,
    name: "Search Gap Detector",
    summary:
      "Scans onsite search events for queries with 0 results over the last 30 days. Flags terms with >50% miss-rate and ≥3 hits.",
    impact: "Capture demand-side intent already showing up — convert to SEO pages or new SKUs.",
    triggers: ["searches_zero_results", "miss_rate"],
    actions: ["create_seo_page"],
  },
];

function Agents() {
  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> Agent catalogue
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Four agents. One revenue loop.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            Every ACOS agent is explainable: it tells you exactly which signal triggered it, what action it
            recommends, and how confident it is. You stay in control of every move.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-5 md:grid-cols-2">
          {AGENTS.map((a) => {
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
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Signals</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.triggers.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">One-click action</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.actions.map((act) => (
                        <Badge key={act} variant="secondary" className="text-[10px]">{act}</Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <Button asChild size="lg"><Link to="/signup">Run these agents on your store</Link></Button>
        </div>
      </section>
    </main>
  );
}
