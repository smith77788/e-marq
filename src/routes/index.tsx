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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ACOS — Autonomous Revenue OS for D2C brands" },
      {
        name: "description",
        content:
          "Connect your store once. AI agents monitor churn, stockouts, AOV leaks, pricing and SEO 24/7 — and queue revenue opportunities for one-click approval.",
      },
      { property: "og:title", content: "ACOS — Autonomous Revenue OS for D2C brands" },
      {
        property: "og:description",
        content:
          "AI agents that find revenue opportunities in your D2C brand and apply them after your one-click approval.",
      },
    ],
  }),
  component: Index,
});

const AGENT_LOOPS = [
  {
    icon: AlertOctagon,
    title: "Churn Prevention",
    description:
      "Detects VIPs whose buying cadence has slipped. Suggests targeted winback touches before they go cold.",
    impact: "+8–15% retained revenue",
  },
  {
    icon: Boxes,
    title: "Stockout Forecast",
    description:
      "Predicts when SKUs will run out. Triggers reorder alerts and surfaces which products to push down funnel.",
    impact: "Eliminate lost sales from OOS",
  },
  {
    icon: TrendingUp,
    title: "AOV Optimization",
    description:
      "Spots categories where average order value is leaking. Recommends bundles, upsells, and shipping thresholds.",
    impact: "+5–12% AOV per bundle",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect your data",
    description: "Plug in your store, payments, and analytics. ACOS reads your orders, customers, and traffic.",
  },
  {
    step: "02",
    title: "Agents run 24/7",
    description: "Specialized AI agents continuously analyze every layer — CRM, inventory, pricing, SEO.",
  },
  {
    step: "03",
    title: "Approve in one click",
    description: "Insights land in your queue with expected impact and confidence score. You stay in control.",
  },
  {
    step: "04",
    title: "Memory loop learns",
    description: "Actions that grow revenue get amplified. Patterns that fail get blocked. Smarter every week.",
  },
];

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, user, navigate]);

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" />
            Autonomous Revenue OS
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Your D2C brand's{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              autonomous growth team
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Connect your store once. AI agents monitor churn, stockouts, AOV leaks, pricing and SEO
            around the clock — and queue revenue opportunities for your one-click approval.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            No credit card required · Connect your existing store
          </p>
        </div>
      </section>

      {/* Agent loops */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Always-on agent loops
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Specialized AI agents for every revenue lever
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            Not a chatbot. Not a dashboard. A team of focused agents that continuously hunt for
            growth in your data.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {AGENT_LOOPS.map((loop) => {
            const Icon = loop.icon;
            return (
              <Card key={loop.title} className="border-border bg-card/50">
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="mt-4 text-lg">{loop.title}</CardTitle>
                  <CardDescription>{loop.description}</CardDescription>
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
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Connect once. Approve. Grow.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="relative">
                <div className="text-3xl font-bold text-primary/30">{item.step}</div>
                <h3 className="mt-2 text-base font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
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
              Why ACOS
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              You stay in control. The system does the work.
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              Every action is queued for your approval with expected impact and confidence score.
              ACOS never moves money or messages your customers without you saying yes.
            </p>
          </div>
          <div className="space-y-4">
            {[
              {
                icon: Crown,
                title: "Multi-tenant from day one",
                description: "Run multiple brands. Each gets isolated data, agents, and approval queue.",
              },
              {
                icon: Database,
                title: "Memory that learns",
                description:
                  "Patterns that work get boosted. Patterns that fail get blocked. Auto-tuned per brand.",
              },
              {
                icon: Users,
                title: "Approval queue, not autopilot",
                description:
                  "One-click approve, reject, or batch. Full revert log. You always know what changed.",
              },
              {
                icon: CheckCircle2,
                title: "Optional commerce shell",
                description:
                  "Don't have a store yet? Spin up a hosted storefront in minutes. Or connect Shopify.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
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
            Stop watching dashboards. Start approving growth.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Set up your first brand in under five minutes.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
