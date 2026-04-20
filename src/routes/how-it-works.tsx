import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Brain, CheckCircle2, Database, RefreshCw, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How ACOS works — Autonomous Revenue OS for D2C brands" },
      {
        name: "description",
        content:
          "ACOS connects to your store, runs always-on AI agents, queues revenue actions for one-click approval, then learns from outcomes. See how the autonomous loop works.",
      },
      { property: "og:title", content: "How ACOS works — Autonomous Revenue OS" },
      {
        property: "og:description",
        content: "Connect your store. Agents run 24/7. Approve in one click. The memory loop learns. See the architecture.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HowItWorks,
});

const STAGES = [
  {
    icon: Database,
    title: "1. Connect data once",
    points: [
      "Plug in your store, payments, analytics, and email tools",
      "ACOS reads orders, customers, events, inventory and traffic",
      "Multi-tenant from day one — run multiple brands isolated",
    ],
  },
  {
    icon: Zap,
    title: "2. Specialized agents run 24/7",
    points: [
      "Churn Risk Predictor — flags VIPs whose cadence has slipped",
      "Stockout Predictor — calculates days-of-supply per SKU",
      "AOV Leak Detector — finds where carts leak before payment",
      "Search Gap Detector — surfaces zero-result search queries",
    ],
  },
  {
    icon: CheckCircle2,
    title: "3. Approve in one click",
    points: [
      "Each insight ships with expected impact + confidence score",
      "Approve, dismiss, or batch — full revert log",
      "ACOS never moves money or messages customers without you",
    ],
  },
  {
    icon: Brain,
    title: "4. Memory loop learns",
    points: [
      "After 7-day measurement window, outcomes feed back",
      "Patterns that grow revenue get amplified per brand",
      "Patterns that fail get auto-deprioritized",
    ],
  },
];

function HowItWorks() {
  return (
    <main className="min-h-screen bg-background">
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> The autonomous loop
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            How ACOS turns your store data into approved revenue
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            ACOS is not a chatbot or another dashboard. It's an autonomous loop: connect → detect → approve → learn.
            Every cycle the system gets sharper for your specific brand.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">Start free <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/agents">See the agents</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {STAGES.map((s) => {
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
              <RefreshCw className="h-4 w-4 text-primary" /> The compounding effect
            </CardTitle>
            <CardDescription>
              Each approval generates evidence. Each measured outcome trains the memory. Within weeks, the system
              prioritises only the patterns that actually produce revenue for your brand.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Ready to put your brand on autopilot — with you in the loop?
          </h2>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button asChild size="lg"><Link to="/signup">Start free</Link></Button>
            <Button asChild size="lg" variant="outline"><Link to="/pricing">View pricing</Link></Button>
          </div>
        </div>
      </section>
    </main>
  );
}
