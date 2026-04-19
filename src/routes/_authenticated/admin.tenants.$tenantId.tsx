import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/tenants/$tenantId")({
  component: TenantDetailPage,
});

function TenantDetailPage() {
  const { tenantId } = Route.useParams();
  const { isSuperAdmin, loading } = useAuth();

  const tenantQuery = useQuery({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status, owner_user_id, created_at")
        .eq("id", tenantId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const configQuery = useQuery({
    queryKey: ["tenant-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_configs")
        .select("brand_name, ui, features, bot, seo, updated_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const productsQuery = useQuery({
    queryKey: ["tenant-products", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, price_cents, currency, stock, is_active, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["tenant-events-count", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["tenant-orders-count", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>This page is restricted to super admins.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (tenantQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading tenant…</p>;
  }

  if (tenantQuery.error || !tenantQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tenant not found</CardTitle>
          <CardDescription>This tenant does not exist or you cannot access it.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/admin/tenants" className="text-sm font-medium text-primary hover:underline">
            ← Back to tenants
          </Link>
        </CardContent>
      </Card>
    );
  }

  const tenant = tenantQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/tenants"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          ← Tenants
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{tenant.name}</h1>
          <Badge variant={tenant.status === "active" ? "default" : "outline"}>
            {tenant.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">/{tenant.slug}</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Products" value={productsQuery.data?.length ?? 0} loading={productsQuery.isLoading} />
            <StatCard label="Orders" value={ordersQuery.data ?? 0} loading={ordersQuery.isLoading} />
            <StatCard label="Events" value={eventsQuery.data ?? 0} loading={eventsQuery.isLoading} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tenant info</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Tenant ID</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.id}</dd>
                <dt className="text-muted-foreground">Owner user ID</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.owner_user_id}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{new Date(tenant.created_at).toLocaleString()}</dd>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
              <CardDescription>
                {productsQuery.data?.length ?? 0} total. Product CRUD coming next loop.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {productsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : productsQuery.data && productsQuery.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productsQuery.data.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {(p.price_cents / 100).toFixed(2)} {p.currency}
                        </TableCell>
                        <TableCell className="text-right">{p.stock}</TableCell>
                        <TableCell>
                          <Badge variant={p.is_active ? "default" : "outline"}>
                            {p.is_active ? "active" : "draft"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No products yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tenant config</CardTitle>
              <CardDescription>
                UI / Features / Bot / SEO. Read-only preview. Editor coming next loop.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {configQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : configQuery.data ? (
                <div className="space-y-4">
                  <ConfigBlock title="Brand name" value={configQuery.data.brand_name} />
                  <ConfigBlock title="UI" value={configQuery.data.ui} />
                  <ConfigBlock title="Features" value={configQuery.data.features} />
                  <ConfigBlock title="Bot" value={configQuery.data.bot} />
                  <ConfigBlock title="SEO" value={configQuery.data.seo} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No config found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-foreground">
          {loading ? "…" : value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

function ConfigBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
