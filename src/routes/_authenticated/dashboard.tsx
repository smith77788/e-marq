import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Wand2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { SetupReadinessCard } from "@/components/owner/SetupReadinessCard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { isSuperAdmin } = useAuth();
  const { tenants, current, setCurrentTenantId, loading } = useTenantContext();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Головна</h1>
          <p className="text-sm text-muted-foreground">
            {isSuperAdmin ? "Режим супер-адміна — видно всі магазини." : "Ваші магазини."}
          </p>
        </div>
        {isSuperAdmin && <Badge variant="secondary">супер-адмін</Badge>}
      </div>

      {current && (
        <SetupReadinessCard tenantId={current.tenant_id} tenantSlug={current.tenant_slug} compact />
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
          {loading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : tenants.length > 0 ? (
            <ul className="divide-y divide-border">
              {tenants.map((t) => {
                const statusLabel =
                  t.status === "active"
                    ? "активний"
                    : t.status === "suspended"
                      ? "заблоковано"
                      : t.status === "archived"
                        ? "в архіві"
                        : t.status;
                return (
                  <li key={t.tenant_id} className="flex items-center justify-between gap-3 py-3">
                    <Link
                      to="/brand"
                      search={{ tenant: t.tenant_id }}
                      onClick={() => setCurrentTenantId(t.tenant_id)}
                      className="flex-1 hover:opacity-80"
                    >
                      <p className="font-medium text-foreground">{t.tenant_name}</p>
                      <p className="text-xs text-muted-foreground">
                        /{t.tenant_slug} · {t.membership_role} · {t.plan_name}
                      </p>
                    </Link>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={t.status === "active" ? "default" : "outline"}>
                        {statusLabel}
                      </Badge>
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                        <Link
                          to="/brand/site-builder"
                          onClick={() => setCurrentTenantId(t.tenant_id)}
                        >
                          <Wand2 className="h-3.5 w-3.5 text-accent" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                        <Link to="/s/$slug" params={{ slug: t.tenant_slug }}>
                          <ExternalLink className="h-3.5 w-3.5 text-primary" />
                        </Link>
                      </Button>
                    </div>
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
