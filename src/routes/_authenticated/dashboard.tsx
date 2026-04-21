import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SetupReadinessCard } from "@/components/owner/SetupReadinessCard";

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Головна</h1>
          <p className="text-sm text-muted-foreground">
            {isSuperAdmin ? "Режим супер-адміна — видно всі магазини." : "Ваші магазини."}
          </p>
        </div>
        {isSuperAdmin && (
          <Badge variant="secondary">супер-адмін</Badge>
        )}
      </div>

      {tenants && tenants.length > 0 && (
        <SetupReadinessCard tenantId={tenants[0].id} tenantSlug={tenants[0].slug} compact />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ваші магазини</CardTitle>
          <CardDescription>
            {isSuperAdmin
              ? "Усі магазини у системі."
              : "Магазини, якими ви володієте або де ви учасник."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : tenants && tenants.length > 0 ? (
            <ul className="divide-y divide-border">
              {tenants.map((t) => {
                const statusLabel =
                  t.status === "active" ? "активний"
                  : t.status === "suspended" ? "заблоковано"
                  : t.status === "archived" ? "в архіві"
                  : t.status;
                return (
                  <li key={t.id} className="flex items-center justify-between py-3">
                    <Link
                      to="/brand"
                      search={{ tenant: t.id }}
                      className="flex-1 hover:opacity-80"
                    >
                      <p className="font-medium text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">/{t.slug}</p>
                    </Link>
                    <Badge variant={t.status === "active" ? "default" : "outline"}>
                      {statusLabel}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Поки немає жодного магазину.</p>
              {isSuperAdmin && (
                <Link to="/admin/tenants" className="font-medium text-primary hover:underline">
                  Створити перший магазин →
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
