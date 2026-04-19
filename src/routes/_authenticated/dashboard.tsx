import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isSuperAdmin } = useAuth();

  const { data: tenants, isLoading } = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {isSuperAdmin ? "Super-admin view — all tenants visible." : "Your workspaces."}
          </p>
        </div>
        {isSuperAdmin && (
          <Badge variant="secondary">super_admin</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your tenants</CardTitle>
          <CardDescription>
            {isSuperAdmin
              ? "All tenants in the system."
              : "Workspaces you own or are a member of."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tenants && tenants.length > 0 ? (
            <ul className="divide-y divide-border">
              {tenants.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">/{t.slug}</p>
                  </div>
                  <Badge variant={t.status === "active" ? "default" : "outline"}>
                    {t.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>No tenants yet.</p>
              {isSuperAdmin && (
                <Link to="/admin/tenants" className="font-medium text-primary hover:underline">
                  Create the first tenant →
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
