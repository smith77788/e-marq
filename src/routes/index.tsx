import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ACOS — Autonomous Revenue OS for D2C" },
      {
        name: "description",
        content:
          "Multi-tenant revenue operating system: storefronts, bots, retention and SEO on autopilot.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, user, navigate]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <section className="max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Autonomous Revenue OS
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Ship a D2C brand in one tenant.
        </h1>
        <p className="mt-4 text-base text-muted-foreground sm:text-lg">
          Storefronts, bots, retention loops and SEO — all driven by a single config per tenant.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
