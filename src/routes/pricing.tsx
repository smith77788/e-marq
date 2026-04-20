import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "ACOS Pricing — Autonomous Revenue OS plans" },
      {
        name: "description",
        content:
          "Simple, usage-based pricing for ACOS. Start free, scale per brand and per insight applied. No contracts, no minimums.",
      },
      { property: "og:title", content: "ACOS Pricing — start free, scale with revenue" },
      {
        property: "og:description",
        content: "Three plans, all with full agent suite, approval queue and memory loop. You only pay when ACOS earns it.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Pricing,
});

const PLANS = [
  {
    name: "Pilot",
    price: "$0",
    cadence: "free for 14 days",
    description: "Connect one brand, run all four agents, approve up to 25 insights.",
    features: [
      "1 tenant brand",
      "All 4 ACOS agents",
      "Approval queue + actions log",
      "Daily orchestrator runs",
    ],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Growth",
    price: "$199",
    cadence: "per brand / month",
    description: "For active D2C operators. Unlimited insights, memory feedback loop, multi-channel apply.",
    features: [
      "Unlimited insights & actions",
      "Memory feedback loop (auto-tune)",
      "Email channel for winbacks & cart recovery",
      "Slack & webhook notifications",
      "Priority support",
    ],
    cta: "Start trial",
    highlight: true,
  },
  {
    name: "Portfolio",
    price: "Custom",
    cadence: "for agencies & multi-brand",
    description: "Manage 5+ brands from a single command centre. White-label and custom agents available.",
    features: [
      "5+ tenants with shared dashboard",
      "Custom agents on request",
      "White-label option",
      "Dedicated success engineer",
    ],
    cta: "Talk to us",
    highlight: false,
  },
];

function Pricing() {
  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> Pricing
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Pay when ACOS earns it
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            Every plan includes the full agent suite, approval queue, and memory loop. Start free, scale per brand.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <Card key={p.name} className={p.highlight ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-card/60"}>
              <CardHeader>
                {p.highlight && (
                  <Badge className="mb-2 w-fit" variant="default">Most popular</Badge>
                )}
                <CardTitle className="text-xl">{p.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-foreground">{p.price}</span>
                  <span className="text-xs text-muted-foreground">{p.cadence}</span>
                </div>
                <CardDescription className="mt-2">{p.description}</CardDescription>
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

        <p className="mt-10 text-center text-xs text-muted-foreground">
          No credit card required to start. Cancel anytime. Multi-tenant isolation included on every plan.
        </p>
      </section>
    </main>
  );
}
