import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { RevenueFeed } from "@/components/owner/RevenueFeed";
import { CustomerRoster } from "@/components/owner/CustomerRoster";
import { ChannelSetup } from "@/components/owner/ChannelSetup";
import { InsightsPanel } from "@/components/owner/InsightsPanel";
import { TrackingSnippet } from "@/components/owner/TrackingSnippet";
import { KpiDashboard } from "@/components/owner/KpiDashboard";
import { RevenueTrendChart } from "@/components/owner/RevenueTrendChart";
import { TopCustomers } from "@/components/owner/TopCustomers";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandPage,
});

function BrandPage() {
  const { tenant: tenantId } = useSearch({ from: "/_authenticated/brand" });
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const { data: tenants } = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-select first tenant if none in URL
  useEffect(() => {
    if (!tenantId && tenants && tenants.length > 0) {
      navigate({ to: "/brand", search: { tenant: tenants[0].id }, replace: true });
    }
  }, [tenantId, tenants, navigate]);

  const current = tenants?.find((t) => t.id === tenantId);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!tenants || tenants.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No brand yet</CardTitle>
          <CardDescription>
            You don't own a brand yet. Ask a super-admin to create one and assign you as owner.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!current) {
    return <p className="text-sm text-muted-foreground">Loading brand…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{current.name}</h1>
            <Badge variant="outline">/{current.slug}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            What the system did for you, who it knows, and how to plug in your channel.
          </p>
        </div>
        {tenants.length > 1 && (
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={tenantId}
            onChange={(e) => navigate({ to: "/brand", search: { tenant: e.target.value } })}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <KpiDashboard tenantId={current.id} />

      <RevenueTrendChart tenantId={current.id} />

      <RevenueFeed tenantId={current.id} />

      <InsightsPanel tenantId={current.id} />

      <TopCustomers tenantId={current.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CustomerRoster tenantId={current.id} />
        <ChannelSetup tenantId={current.id} tenantSlug={current.slug} />
      </div>

      <TrackingSnippet tenantSlug={current.slug} />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Storefront & catalogue
          </CardTitle>
          <CardDescription className="text-xs">
            Public storefront lives at <Link to="/s/$slug" params={{ slug: current.slug }} className="text-primary hover:underline">/s/{current.slug}</Link>. Manage products and orders in the brand admin.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
